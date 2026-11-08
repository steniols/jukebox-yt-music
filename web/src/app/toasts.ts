import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  isError: boolean;
}

const DURATION_MS = 4000;

@Injectable({ providedIn: 'root' })
export class Toasts {
  private nextId = 1;
  readonly items = signal<Toast[]>([]);

  show(text: string, isError = false): void {
    const id = this.nextId++;
    this.items.update((items) => [...items, { id, text, isError }]);
    setTimeout(() => this.dismiss(id), DURATION_MS);
  }

  dismiss(id: number): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }
}
