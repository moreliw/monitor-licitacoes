import { Routes } from '@angular/router';
import { OpportunitiesPage } from './pages/opportunities';
import { DetailPage } from './pages/detail';
import { WatchlistPage } from './pages/watchlist';
import { AlertsPage } from './pages/alerts';
import { SourcesPage } from './pages/sources';
import { SettingsPage } from './pages/settings';
import { MarketPage } from './pages/market';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'oportunidades' },
  { path: 'oportunidades', component: OpportunitiesPage, title: 'Oportunidades' },
  { path: 'oportunidade/:id', component: DetailPage, title: 'Detalhe da oportunidade' },
  { path: 'acompanhadas', component: WatchlistPage, title: 'Acompanhadas' },
  { path: 'alertas', component: AlertsPage, title: 'Alertas' },
  { path: 'mercado', component: MarketPage, title: 'Mercado de software' },
  { path: 'fontes', component: SourcesPage, title: 'Fontes e sincronização' },
  { path: 'configuracoes', component: SettingsPage, title: 'Configurações' },
  { path: '**', redirectTo: 'oportunidades' },
];
