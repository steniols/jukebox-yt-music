import { inject, Injectable, signal } from '@angular/core';
import { Api, User } from './api';

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(Api);

  /** undefined enquanto a sessão é verificada; null para visitantes. */
  readonly user = signal<User | null | undefined>(undefined);

  load(): void {
    this.api.me().subscribe({
      next: (user) => this.user.set(user),
      error: () => this.user.set(null),
    });
  }

  login(): void {
    window.location.href = '/api/youtube/login';
  }

  logout(): void {
    this.api.logout().subscribe({
      next: () => (window.location.href = '/'),
      error: () => (window.location.href = '/'),
    });
  }
}
