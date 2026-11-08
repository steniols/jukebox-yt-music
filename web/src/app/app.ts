import { Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Session } from './session';
import { Toasts } from './toasts';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  template: `
    <header class="topbar">
      <a routerLink="/" class="brand">
        <span class="brand-mark" aria-hidden="true">♫</span>
        Jukebox
      </a>
      @if (session.user(); as user) {
        <div class="account">
          <span class="account-name">{{ user.display_name }}</span>
          <button type="button" class="button ghost small" (click)="session.logout()">Sair</button>
        </div>
      }
    </header>

    <main class="page">
      <router-outlet />
    </main>

    <footer class="footer">Desenvolvido com <span aria-hidden="true">♥</span> por Stenio</footer>

    <div class="toasts" aria-live="polite">
      @for (toast of toasts.items(); track toast.id) {
        <div class="toast" [class.error]="toast.isError" role="status">{{ toast.text }}</div>
      }
    </div>
  `,
})
export class App implements OnInit {
  protected readonly session = inject(Session);
  protected readonly toasts = inject(Toasts);

  ngOnInit(): void {
    this.session.load();
  }
}
