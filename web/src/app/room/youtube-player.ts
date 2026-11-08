import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

interface YtPlayer {
  loadVideoById(videoId: string): void;
  stopVideo(): void;
  destroy(): void;
}

interface YtGlobal {
  Player: new (element: HTMLElement, options: unknown) => YtPlayer;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YtGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';
let apiReady: Promise<YtGlobal> | null = null;

function loadApi(): Promise<YtGlobal> {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) {
        resolve(window.YT);
        return;
      }
      window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
      const script = document.createElement('script');
      script.src = API_URL;
      script.onerror = () => {
        apiReady = null;
        reject(new Error('Falha ao carregar o player do YouTube'));
      };
      document.head.appendChild(script);
    });
  }
  return apiReady;
}

/**
 * Player oficial do YouTube. A API dele envia a URL da página ao YouTube, então
 * este componente nunca pode aparecer em uma página com o link secreto na URL.
 */
@Component({
  selector: 'app-youtube-player',
  template: `<div class="frame"><div #target></div></div>`,
  styles: `
    .frame {
      position: relative;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: #000;
      border-radius: 8px;
    }
    .frame ::ng-deep iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  `,
})
export class YoutubePlayer {
  readonly videoId = input<string | null>(null);
  readonly ended = output<void>();
  readonly failed = output<number | null>();
  readonly autoplayBlocked = output<void>();

  private readonly target = viewChild.required<ElementRef<HTMLElement>>('target');
  private player: YtPlayer | null = null;
  private ready = false;
  private loadedId: string | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;

    afterNextRender(() => {
      loadApi()
        .then((YT) => {
          if (!destroyed) this.createPlayer(YT);
        })
        .catch(() => this.failed.emit(null));
    });

    effect(() => {
      const id = this.videoId();
      if (this.ready) this.sync(id);
    });

    destroyRef.onDestroy(() => {
      destroyed = true;
      this.player?.destroy();
      this.player = null;
    });
  }

  private createPlayer(YT: YtGlobal): void {
    this.player = new YT.Player(this.target().nativeElement, {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          this.ready = true;
          this.sync(this.videoId());
        },
        onStateChange: (event: { data: number }) => {
          if (event.data === YT.PlayerState.ENDED) this.ended.emit();
        },
        onError: (event: { data: number }) => this.failed.emit(event.data),
        onAutoplayBlocked: () => this.autoplayBlocked.emit(),
      },
    });
  }

  private sync(id: string | null): void {
    if (id === this.loadedId || !this.player) return;
    this.loadedId = id;
    if (id) {
      this.player.loadVideoById(id);
    } else {
      this.player.stopVideo();
    }
  }
}
