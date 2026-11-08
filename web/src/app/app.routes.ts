import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home').then((m) => m.Home), title: 'Jukebox' },
  { path: 'j/:token', loadComponent: () => import('./room/room').then((m) => m.Room), title: 'Jukebox' },
  { path: 'tocar/:id', loadComponent: () => import('./room/room').then((m) => m.Room), title: 'Jukebox' },
  { path: '**', redirectTo: '' },
];
