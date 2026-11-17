import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api, fmtDate, fmtRelative } from './api';
import { Icon } from './icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly api = inject(Api);
  protected readonly fmtDate = fmtDate;
  protected readonly fmtRelative = fmtRelative;

  protected readonly nav = computed(() => {
    const s = this.api.stats();
    return [
      { path: '/oportunidades', label: 'Oportunidades', icon: 'target', count: s?.['abertas'] ? `${s['abertas']}` : null, hint: 'abertas' },
      { path: '/acompanhadas', label: 'Acompanhadas', icon: 'bookmark', count: s?.['watched'] ? `${s['watched']}` : null, hint: 'acompanhadas' },
      { path: '/alertas', label: 'Alertas', icon: 'bell', count: s?.['unread'] ? `${s['unread']}` : null, hint: 'não lidos', alert: true },
      { path: '/mercado', label: 'Mercado de software', icon: 'chart', count: null, hint: '' },
    ];
  });
  protected readonly system = [
    { path: '/fontes', label: 'Fontes e sincronização', icon: 'refresh' },
    { path: '/configuracoes', label: 'Configurações', icon: 'settings' },
  ];

  protected readonly stale = computed(() => !!this.api.status()?.['overview']?.sources?.[0]?.stale);
  protected readonly lastFull = computed(() => this.api.status()?.['overview']?.sources?.[0]?.lastFullSync ?? null);
  protected readonly running = computed(() => !!this.api.progress()?.['running']);
  protected readonly progressPct = computed(() => {
    const p = this.api.progress();
    return p?.['totalPages'] ? Math.min(100, Math.round(((p['page'] ?? 0) / p['totalPages']) * 100)) : null;
  });
  protected readonly upd = computed(() => this.api.update());
  protected readonly showUpdate = computed(() => ['baixando', 'pronto', 'instalando'].includes(this.upd()?.['status']));

  protected sync(): void { void this.api.raw?.sync.run(); }
  protected installUpdate(): void { void this.api.raw?.update.install(); }
  protected cycleTheme(): void {
    const t = this.api.theme();
    this.api.setTheme(t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto');
  }
  protected themeLabel(): string { const t = this.api.theme(); return t === 'auto' ? 'Tema do sistema' : t === 'light' ? 'Tema claro' : 'Tema escuro'; }
  protected themeIcon(): string { const t = this.api.theme(); return t === 'auto' ? 'monitor' : t === 'light' ? 'sun' : 'moon'; }
}
