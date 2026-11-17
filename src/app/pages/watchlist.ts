import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, LABEL_TEXT, Row, deadlineTone, fmtDate, fmtMoney, fmtRelative } from '../api';
import { Icon } from '../icon';

const COLUMNS: { id: string; label: string; hint: string }[] = [
  { id: 'triagem', label: 'Triagem', hint: 'Avaliar se vale a proposta' },
  { id: 'analise', label: 'Em análise', hint: 'Edital, requisitos e preço' },
  { id: 'descartada', label: 'Descartadas', hint: 'Sem lembretes' },
];

@Component({
  selector: 'app-watchlist',
  imports: [RouterLink, Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <span class="eyebrow">Pipeline comercial</span>
        <h1>Acompanhadas</h1>
        <p>Oportunidades em triagem e análise, ordenadas pelo prazo mais próximo. Lembretes 72 h, 24 h e 3 h antes do encerramento.</p>
      </div>
      <div class="actions">
        <button [class.on]="onlyFav()" (click)="onlyFav.set(!onlyFav())" [attr.aria-pressed]="onlyFav()"><app-icon name="star" [size]="15" /> Só favoritas</button>
      </div>
    </header>

    @if (total() === 0) {
      <div class="card empty">
        <div class="e-icon"><app-icon name="bookmark" [size]="26" /></div>
        <h2>Nenhuma oportunidade acompanhada</h2>
        <p>Abra uma oportunidade e escolha “Triagem” ou “Em análise” em Acompanhamento.</p>
        <a class="btn primary" routerLink="/oportunidades">Ver oportunidades</a>
      </div>
    } @else {
      <div class="board">
        @for (col of columns; track col.id) {
          <section class="column" [attr.aria-labelledby]="'c-' + col.id">
            <header class="col-head">
              <h2 [id]="'c-' + col.id">{{ col.label }}</h2>
              <span class="count">{{ byStatus()[col.id].length }}</span>
              <p class="muted small">{{ col.hint }}</p>
            </header>
            <div class="col-body">
              @for (r of byStatus()[col.id]; track r['id']) {
                <article class="wcard fade-in">
                  <a [routerLink]="['/oportunidade', r['id']]" class="w-main">
                    <div class="row" style="gap:6px">
                      <span class="badge" [class]="'badge b-' + r['relevance']">{{ labelText[r['relevance']] }}</span>
                      @if (r['favorito']) { <span class="fav" aria-label="Favorita"><app-icon name="star" [size]="13" /></span> }
                    </div>
                    <strong class="clamp-2">{{ r['objeto'] }}</strong>
                    <span class="muted small">{{ r['orgao_nome'] }} · {{ r['uf'] }}</span>
                  </a>
                  <div class="w-foot">
                    <span class="dl" [class]="'dl t-' + deadlineTone(r['encerramento_utc'], r['derived_state'])">
                      <app-icon name="clock" [size]="13" />
                      {{ r['derived_state'] === 'Recebendo propostas' ? fmtRelative(r['encerramento_utc']) : r['derived_state'] }}
                    </span>
                    <span class="num small muted">{{ fmtMoney(r['valor_estimado_cents'], r['orcamento_sigiloso']) }}</span>
                  </div>
                  <div class="moves">
                    @for (to of columns; track to.id) {
                      @if (to.id !== col.id) {
                        <button class="sm ghost" (click)="move(r, to.id)" [attr.aria-label]="'Mover para ' + to.label">{{ to.label }} <app-icon name="arrowRight" [size]="12" /></button>
                      }
                    }
                  </div>
                </article>
              } @empty {
                <p class="muted small empty-col">Nada aqui.</p>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: `
    button.on { background: var(--warn-soft); border-color: var(--warn); color: var(--warn); }
    .board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
    @media (max-width: 1100px) { .board { grid-template-columns: 1fr; } }
    .column { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px; }
    .col-head { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 4px 6px 12px; }
    .col-head p { grid-column: 1 / -1; }
    .count { min-width: 24px; height: 22px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); display: grid; place-items: center; font-size: 12px; font-weight: 650; }
    .col-body { display: grid; gap: 10px; }
    .wcard { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 13px; box-shadow: var(--shadow-sm); display: grid; gap: 10px; }
    .wcard:hover { box-shadow: var(--shadow); }
    .w-main { display: grid; gap: 6px; color: inherit; text-decoration: none; }
    .w-main:hover strong { color: var(--primary-ink); }
    .w-main strong { font-size: 13.5px; font-weight: 600; line-height: 1.4; }
    .fav { color: #f5b301; } .fav ::ng-deep svg { fill: #f5b301; }
    .w-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .dl { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--muted); }
    .dl.t-bad { color: var(--bad); } .dl.t-warn { color: var(--warn); } .dl.t-ok { color: var(--ok); }
    .moves { display: flex; gap: 4px; border-top: 1px dashed var(--border); padding-top: 8px; }
    .moves button { font-size: 11.5px; }
    .empty-col { padding: 14px 6px; text-align: center; }
  `,
})
export class WatchlistPage implements OnInit {
  protected readonly api = inject(Api);
  protected readonly columns = COLUMNS;
  protected readonly labelText = LABEL_TEXT;
  protected readonly fmtDate = fmtDate; protected readonly fmtMoney = fmtMoney; protected readonly fmtRelative = fmtRelative; protected readonly deadlineTone = deadlineTone;
  protected readonly rows = signal<Row[]>([]);
  protected readonly onlyFav = signal(false);
  protected readonly total = computed(() => this.rows().length);
  protected readonly byStatus = computed(() => {
    const out: Record<string, Row[]> = { triagem: [], analise: [], descartada: [] };
    for (const r of this.rows()) if (!this.onlyFav() || r['favorito']) (out[r['watch_status']] ??= []).push(r);
    return out;
  });

  constructor() { effect(() => { this.api.alertsVersion(); untracked(() => void this.load()); }); }
  ngOnInit(): void { void this.load(); }

  protected async load(): Promise<void> {
    if (!this.api.available) return;
    const all: Row[] = [];
    for (const w of ['triagem', 'analise', 'descartada']) {
      const r = await this.api.raw.opps.list({ watch: w, sort: 'prazo', dir: 'asc', pageSize: 200 });
      all.push(...r.rows);
    }
    this.rows.set(all);
  }
  protected async move(r: Row, status: string): Promise<void> {
    await this.api.raw.watch.set({ id: r['id'], patch: { status } });
    await this.load(); void this.api.refreshStats();
  }
}
