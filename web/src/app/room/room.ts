import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { Api, errorMessage, ImportSummary, RoomState, Track } from '../api';
import { Toasts } from '../toasts';
import { YoutubePlayer } from './youtube-player';

const POLL_INTERVAL_MS = 3000;
const IMPORT_PAGE_SIZE = 50;
const NAME_STORAGE_KEY = 'jukebox.name';

function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // Sem armazenamento, o nome só não é lembrado na próxima visita.
  }
}

@Component({
  selector: 'app-room',
  imports: [FormsModule, YoutubePlayer],
  templateUrl: './room.html',
  styleUrl: './room.css',
})
export class Room implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private token = '';

  protected readonly state = signal<RoomState | null>(null);
  protected readonly closedMessage = signal<string | null>(null);
  protected readonly offline = signal(false);
  protected readonly adding = signal(false);
  protected readonly url = signal('');
  protected readonly name = signal(readStoredName());
  protected readonly importUrl = signal('');
  protected readonly importing = signal(false);

  protected readonly playing = signal(false);
  protected readonly autoplayBlocked = signal(false);
  protected readonly nowPlayingId = computed(() => this.state()?.nowPlaying?.videoId ?? null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private advancing = false;
  // Respostas que chegam fora de ordem não podem sobrescrever um estado mais novo.
  private lastRequest = 0;
  private lastApplied = 0;

  private wakeLock: WakeLockSentinel | null = null;
  private requestingWakeLock = false;
  private destroyed = false;

  private readonly onVisibility = () => {
    if (document.hidden) return;
    this.poll();
    // O navegador libera a trava quando a página sai de vista.
    if (this.wantsScreenOn()) void this.keepScreenOn();
  };

  constructor() {
    // Com a jukebox tocando, a primeira música da fila começa sozinha.
    effect(() => {
      const state = this.state();
      if (this.playing() && state?.isHost && !state.nowPlaying && state.queue.length) {
        this.advance(null);
      }
    });

    effect(() => {
      if (this.wantsScreenOn()) {
        void this.keepScreenOn();
      } else {
        this.allowScreenOff();
      }
    });
  }

  private wantsScreenOn(): boolean {
    return !this.destroyed && this.playing() && !this.closedMessage();
  }

  private async keepScreenOn(): Promise<void> {
    if (this.requestingWakeLock || (this.wakeLock && !this.wakeLock.released)) return;

    this.requestingWakeLock = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.wantsScreenOn()) {
        this.wakeLock = lock;
      } else {
        void lock.release();
      }
    } catch {
      // Sem suporte ou com a bateria baixa, a tela só segue a configuração do aparelho.
    } finally {
      this.requestingWakeLock = false;
    }
  }

  private allowScreenOff(): void {
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (token) {
      this.enter(token);
      return;
    }

    // Em /tocar/:id o link secreto não fica na URL, pois é aqui que o player roda.
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api.listJukeboxes().subscribe({
      next: (jukeboxes) => {
        const shareToken = jukeboxes.find((jukebox) => jukebox.id === id)?.shareToken;
        if (shareToken) {
          this.enter(shareToken);
        } else {
          this.closedMessage.set('Jukebox não encontrada.');
        }
      },
      error: () => this.closedMessage.set('Entre com sua conta para tocar esta jukebox.'),
    });
  }

  private enter(token: string): void {
    this.token = token;
    if (history.state?.autostart) this.playing.set(true);
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.allowScreenOff();
    this.stopPolling();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private apply(requestId: number, state: RoomState): void {
    if (requestId < this.lastApplied) return;
    this.lastApplied = requestId;
    this.state.set(state);
    this.offline.set(false);
  }

  private handleClosed(error: HttpErrorResponse): boolean {
    if (error.error?.code !== 'room_closed') return false;
    this.closedMessage.set(`${errorMessage(error)} Peça um novo link a quem criou a jukebox.`);
    this.state.set(null);
    this.stopPolling();
    return true;
  }

  private poll(): void {
    if (this.pollInFlight || document.hidden || this.closedMessage()) return;

    this.pollInFlight = true;
    const requestId = ++this.lastRequest;
    this.api.getRoom(this.token).subscribe({
      next: (state) => {
        this.pollInFlight = false;
        this.apply(requestId, state);
      },
      error: (error: HttpErrorResponse) => {
        this.pollInFlight = false;
        if (!this.handleClosed(error)) this.offline.set(true);
      },
    });
  }

  private run(request: Observable<RoomState>, onDone?: () => void): void {
    const requestId = ++this.lastRequest;
    request.subscribe({
      next: (state) => {
        this.apply(requestId, state);
        onDone?.();
      },
      error: (error: HttpErrorResponse) => {
        onDone?.();
        if (!this.handleClosed(error)) this.toasts.show(errorMessage(error), true);
      },
    });
  }

  protected add(event: Event): void {
    event.preventDefault();
    const url = this.url().trim();
    if (!url || this.adding()) return;

    const name = this.name().trim();
    storeName(name);
    this.adding.set(true);
    const requestId = ++this.lastRequest;
    this.api.addTrack(this.token, url, name).subscribe({
      next: (state) => {
        this.apply(requestId, state);
        this.adding.set(false);
        this.url.set('');
        this.toasts.show('Música adicionada à fila.');
      },
      error: (error: HttpErrorResponse) => {
        this.adding.set(false);
        if (!this.handleClosed(error)) this.toasts.show(errorMessage(error), true);
      },
    });
  }

  protected importPlaylist(event: Event): void {
    event.preventDefault();
    const url = this.importUrl().trim();
    if (!url || this.importing()) return;

    this.importing.set(true);
    const requestId = ++this.lastRequest;
    this.api.importPlaylist(this.token, url).subscribe({
      next: ({ data, summary }) => {
        this.apply(requestId, data);
        this.importing.set(false);
        this.importUrl.set('');
        this.toasts.show(this.importMessage(summary), summary.added === 0);
      },
      error: (error: HttpErrorResponse) => {
        this.importing.set(false);
        if (!this.handleClosed(error)) this.toasts.show(errorMessage(error), true);
      },
    });
  }

  protected shareUrl(): string {
    return `${window.location.origin}/j/${this.token}`;
  }

  protected async copyLink(input: HTMLInputElement): Promise<void> {
    input.select();
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.toasts.show('Link copiado.');
    } catch {
      this.toasts.show('Link selecionado. Copie com Ctrl+C ou segurando o dedo.');
    }
  }

  private importMessage(summary: ImportSummary): string {
    const { added, duplicates, unavailable, overLimit, total } = summary;
    const skipped: string[] = [];
    if (duplicates) skipped.push(`${duplicates} já na fila`);
    if (unavailable) skipped.push(`${unavailable} indisponíveis`);
    if (overLimit) skipped.push(`${overLimit} sem espaço na fila`);
    if (total > IMPORT_PAGE_SIZE) skipped.push(`só as primeiras ${IMPORT_PAGE_SIZE} de ${total} foram lidas`);

    const main =
      added === 1 ? '1 música importada' : added ? `${added} músicas importadas` : 'Nenhuma música importada';
    return skipped.length ? `${main} (${skipped.join('; ')}).` : `${main}.`;
  }

  protected toggleVote(track: Track): void {
    this.run(
      track.votedByMe ? this.api.clearVote(this.token) : this.api.vote(this.token, track.id),
    );
  }

  protected remove(track: Track): void {
    if (!window.confirm(`Remover "${track.title}" da fila?`)) return;
    this.run(this.api.removeTrack(this.token, track.id));
  }

  protected start(): void {
    const id = this.state()?.id;
    if (this.route.snapshot.paramMap.has('token') && id) {
      this.router.navigate(['/tocar', id], { replaceUrl: true, state: { autostart: true } });
      return;
    }
    this.playing.set(true);
  }

  protected skip(): void {
    this.advance(this.state()?.nowPlaying?.id ?? null);
  }

  protected onEnded(): void {
    this.autoplayBlocked.set(false);
    this.skip();
  }

  protected onPlayerFailed(code: number | null): void {
    if (code === null) {
      this.toasts.show('Não foi possível carregar o player do YouTube.', true);
      return;
    }
    this.toasts.show('Essa música não pôde ser tocada. Indo para a próxima.', true);
    this.skip();
  }

  private advance(fromTrackId: number | null): void {
    if (this.advancing) return;
    this.advancing = true;
    this.run(this.api.advance(this.token, fromTrackId), () => (this.advancing = false));
  }

  protected duration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
      : `${minutes}:${rest}`;
  }

  protected voteLabel(count: number): string {
    return count === 1 ? '1 voto' : `${count} votos`;
  }
}
