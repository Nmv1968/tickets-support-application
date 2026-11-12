import { Routes } from '@angular/router';
import { authGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', title: 'Ingresar · Soporte', loadComponent: () => import('./pages/login').then((m) => m.LoginPage) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'casos' },
      { path: 'casos', title: 'Casos · Soporte', loadComponent: () => import('./pages/tickets/tickets').then((m) => m.TicketsPage) },
      { path: 'tablero', title: 'Tablero · Soporte', loadComponent: () => import('./pages/board').then((m) => m.BoardPage) },
      { path: 'dashboard', title: 'Dashboard · Soporte', loadComponent: () => import('./pages/dashboard').then((m) => m.DashboardPage) },
      {
        path: 'configuracion',
        title: 'Configuración · Soporte',
        loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
