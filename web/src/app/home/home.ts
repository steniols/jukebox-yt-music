import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorMessage, Jukebox, PrivacyStatus } from '../api';
import { Session } from '../session';
import { Toasts } from '../toasts';

const LOGIN_ERRORS: Record<string, string> = {
  access_denied: 'O acesso à conta do Google não foi autorizado.',
  invalid_state: 'Não foi possível validar o login. Tente novamente.',
  missing_scope: 'Para usar a jukebox, autorize o acesso ao YouTube na tela do Google.',
  google_error: 'O Google não concluiu o login. Tente novamente.',
};

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly session = inject(Session);

  protected readonly jukeboxes = signal<Jukebox[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly title = signal('');
  protected readonly privacy = signal<PrivacyStatus>('unlisted');

  constructor() {
    let loadedFor: string | null = null;
    effect(() => {
      const user = this.session.user();
      if (user && loadedFor !== user.id) {
        loadedFor = user.id;
        this.load();
      }
    });
  }

  ngOnInit(): void {
    const loginError = this.route.snapshot.queryParamMap.get('login_error');
    if (loginError) {
      this.toasts.show(LOGIN_ERRORS[loginError] ?? LOGIN_ERRORS['google_error'], true);
      this.router.navigate(['/'], { replaceUrl: true });
    }
  }

  private load(): void {
    this.loading.set(true);
    this.api.listJukeboxes().subscribe({
      next: (jukeboxes) => {
        this.jukeboxes.set(jukeboxes);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        this.handleError(error);
      },
    });
  }

  private handleError(error: HttpErrorResponse): void {
    if (error.status === 401) {
      this.session.user.set(null);
    }
    this.toasts.show(errorMessage(error), true);
  }

  private replace(updated: Jukebox): void {
    this.jukeboxes.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
  }

  protected shareUrl(jukebox: Jukebox): string {
    return `${window.location.origin}/j/${jukebox.shareToken}`;
  }

  protected playlistUrl(jukebox: Jukebox): string {
    return `https://music.youtube.com/playlist?list=${encodeURIComponent(jukebox.youtubePlaylistId)}`;
  }

  protected create(event: Event): void {
    event.preventDefault();
    const title = this.title().trim();
    if (!title || this.saving()) return;

    this.saving.set(true);
    this.api.createJukebox(title, this.privacy()).subscribe({
      next: (jukebox) => {
        this.jukeboxes.update((list) => [jukebox, ...list]);
        this.title.set('');
        this.saving.set(false);
        this.toasts.show('Jukebox criada. Agora é só compartilhar o link.');
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.handleError(error);
      },
    });
  }

  protected async copy(jukebox: Jukebox, input: HTMLInputElement): Promise<void> {
    input.select();
    try {
      await navigator.clipboard.writeText(this.shareUrl(jukebox));
      this.toasts.show('Link copiado.');
    } catch {
      this.toasts.show('Link selecionado. Copie com Ctrl+C ou segurando o dedo.');
    }
  }

  protected toggleActive(jukebox: Jukebox): void {
    this.api.setActive(jukebox.id, !jukebox.active).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.toasts.show(updated.active ? 'Link reativado.' : 'Link encerrado.');
      },
      error: (error: HttpErrorResponse) => this.handleError(error),
    });
  }

  protected regenerate(jukebox: Jukebox): void {
    if (!window.confirm('Gerar um novo link? O link atual deixará de funcionar para todos.')) return;

    this.api.regenerateLink(jukebox.id).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.toasts.show('Novo link gerado.');
      },
      error: (error: HttpErrorResponse) => this.handleError(error),
    });
  }

  protected remove(jukebox: Jukebox): void {
    const question = `Excluir a jukebox "${jukebox.title}"? O link e a fila serão apagados. A playlist continua na sua conta do YouTube.`;
    if (!window.confirm(question)) return;

    this.api.deleteJukebox(jukebox.id).subscribe({
      next: () => {
        this.jukeboxes.update((list) => list.filter((item) => item.id !== jukebox.id));
        this.toasts.show('Jukebox excluída.');
      },
      error: (error: HttpErrorResponse) => this.handleError(error),
    });
  }
}
