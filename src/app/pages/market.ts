import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Row, UFS, fmtCompactMoney, fmtDate, fmtDay, fmtInt, fmtMoney, stateTone } from '../api';
import { Icon } from '../icon';

const ESFERAS: [string, string][] = [['M', 'Municipal'], ['E', 'Estadual'], ['F', 'Federal'], ['D', 'Distrital']];

@Component({
  selector: 'app-market',
  imports: [FormsModule, Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <h1>Mercado de software</h1>
        <p>Todas as contratações de software encontradas no PNCP, de qualquer órgão, agrupadas pelo tipo de produto pedido.</p>
      </div>
      <div class="actions">
        <label class="sr-only" for="bf">Período para ampliar</label>
        <select id="bf" [(ngModel)]="backfillDays" style="width:140px">
          <option [ngValue]="30">30 dias</option><option [ngValue]="90">90 dias</option><option [ngValue]="180">180 dias</option>
        </select>
        <button (click)="backfill()" title="Coleta publicações anteriores (roda em segundo plano, pode ser pausada em Fontes)"><app-icon name="layers" [size]="15" /> Ampliar histórico</button>
        <button (click)="export()"><app-icon name="download" [size]="15" /> Exportar CSV</button>
      </div>
    </header>

    <section class="card toolbar" aria-label="Filtros do mercado">
      <div class="row">
        <div class="segmented" role="group" aria-label="Período de publicação">
          @for (p of periods; track p[0]) {
            <button [attr.aria-pressed]="dias() === p[0]" (click)="dias.set(p[0]); reload()">{{ p[1] }}</button>
          }
        </div>
        <label class="switch"><input type="checkbox" [ngModel]="abertas()" (ngModelChange)="abertas.set($event); reload()" /> Só com propostas abertas</label>
        <span class="divider"></span>
        <div class="chips" role="group" aria-label="Esfera">
          @for (e of esferas; track e[0]) {
            <button class="chip" [attr.aria-pressed]="esfera().includes(e[0])" (click)="toggleEsfera(e[0])">{{ e[1] }}</button>
          }
        </div>
        <label class="sr-only" for="muf">UF</label>
        <select id="muf" class="right" style="width:140px" [ngModel]="uf()" (ngModelChange)="uf.set($event); reload()">
          <option value="">Todas as UFs</option>
          @for (u of ufs; track u) { <option [value]="u">{{ u }}</option> }
        </select>
      </div>
    </section>

    @if (msg()) { <div class="banner info" style="margin-bottom:14px"><app-icon name="info" /> {{ msg() }}</div> }

    @if (ov(); as o) {
      <section class="kpis" aria-label="Resumo do mercado">
        <div class="kpi"><span class="k-label">Contratações de software</span>
          <span class="k-value">{{ fmtInt(o['kpis'].total) }}</span><span class="k-sub">{{ o['byCategory'].length }} categorias de produto</span></div>
        <div class="kpi"><span class="k-label">Valor estimado somado</span>
          <span class="k-value">{{ fmtCompactMoney(o['kpis'].valor) }}</span><span class="k-sub">orçamentos publicados (sigilosos fora)</span></div>
        <div class="kpi"><span class="k-label">Órgãos compradores</span>
          <span class="k-value">{{ fmtInt(o['kpis'].orgaos) }}</span><span class="k-sub">em {{ fmtInt(o['kpis'].municipios) }} municípios</span></div>
        <div class="kpi"><span class="k-label">Abertas agora</span>
          <span class="k-value">{{ fmtInt(o['kpis'].abertas) }}</span><span class="k-sub">recebendo propostas ou com abertura futura</span></div>
      </section>

      @if (o['kpis'].total === 0) {
        <div class="card empty">
          <div class="e-icon"><app-icon name="chart" [size]="26" /></div>
          <h2>O mapa de mercado começa a se formar na próxima coleta</h2>
          <p>Cada sincronização registra aqui toda contratação de software do PNCP, de qualquer órgão. Use “Ampliar histórico” para analisar meses anteriores.</p>
        </div>
      } @else {
        <div class="grid-main">
          <section class="card" aria-labelledby="h-cat">
            <div class="card-head">
              <div class="grow"><h2 id="h-cat">Onde está a demanda</h2><p>Contratações por categoria de produto · clique para ver a lista</p></div>
              <div class="segmented" role="group" aria-label="Medida">
                <button [attr.aria-pressed]="measure() === 'n'" (click)="measure.set('n')">Quantidade</button>
                <button [attr.aria-pressed]="measure() === 'valor'" (click)="measure.set('valor')">Valor</button>
              </div>
            </div>
            <div class="card-body">
              <ol class="ranking">
                @for (c of categories(); track c['id']; let i = $index) {
                  <li>
                    <button class="rank-row" [class.sel]="categoria() === c['id']" (click)="pick(c['id'])"
                      [attr.aria-pressed]="categoria() === c['id']"
                      [title]="c['label'] + ': ' + fmtInt(c['n']) + ' contratações · ' + fmtMoney(c['valor']) + ' · ' + fmtInt(c['abertas']) + ' abertas · ' + fmtInt(c['orgaos']) + ' órgãos'">
                      <span class="pos num">{{ i + 1 }}</span>
                      <span class="lbl">
                        <span class="name">{{ c['label'] }} @if (c['id'] === 'legislativo') { <span class="badge plain b-primary">seu nicho</span> }</span>
                        <span class="track"><span class="fill" [style.width.%]="share(c)"></span></span>
                      </span>
                      <span class="val num">
                        <strong>{{ measure() === 'n' ? fmtInt(c['n']) : fmtCompactMoney(c['valor']) }}</strong>
                        <span class="muted small">{{ measure() === 'n' ? fmtCompactMoney(c['valor']) : fmtInt(c['n']) + ' contrat.' }} · {{ fmtInt(c['abertas']) }} abertas</span>
                      </span>
                    </button>
                  </li>
                }
              </ol>
            </div>
          </section>

          <div class="stack">
            <section class="card" aria-labelledby="h-wk">
              <div class="card-head"><div><h2 id="h-wk">Tendência semanal</h2><p>Novas contratações de software publicadas por semana</p></div></div>
              <div class="card-body">
                @if (o['weekly'].length < 2) { <p class="muted small">Ainda sem semanas suficientes. Amplie o histórico para ver a tendência.</p> }
                @else {
                  <div class="cols" role="img" [attr.aria-label]="weeklyLabel()">
                    @for (w of o['weekly']; track w['semana']) {
                      <div class="col" [title]="'Semana de ' + fmtWeek(w['inicio']) + ': ' + fmtInt(w['n']) + ' contratações'">
                        <span class="c-val num">{{ w['n'] }}</span>
                        <span class="c-bar" [style.height.%]="weekPct(w['n'])"></span>
                        <span class="c-lbl">{{ fmtWeek(w['inicio']) }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            </section>

            <section class="card" aria-labelledby="h-esf">
              <div class="card-head"><div><h2 id="h-esf">Por esfera</h2><p>Quem está comprando</p></div></div>
              <div class="card-body">
                @for (e of o['byEsfera']; track e['esfera']) {
                  <div class="hbar" [title]="e['label'] + ': ' + fmtInt(e['n']) + ' contratações · ' + fmtMoney(e['valor'])">
                    <span class="hb-l">{{ e['label'] }}</span>
                    <span class="track"><span class="fill" [style.width.%]="pct(e['n'], o['kpis'].total)"></span></span>
                    <span class="hb-v num">{{ fmtInt(e['n']) }}</span>
                  </div>
                }
              </div>
            </section>

            <section class="card" aria-labelledby="h-uf">
              <div class="card-head"><div class="grow"><h2 id="h-uf">Estados com mais demanda</h2><p>Top 10 por quantidade</p></div></div>
              <div class="card-body">
                @for (u of o['byUf'].slice(0, 10); track u['uf']) {
                  <button class="hbar as-btn" (click)="uf.set(u['uf']); reload()" [title]="u['uf'] + ': ' + fmtInt(u['n']) + ' contratações · ' + fmtMoney(u['valor']) + ' (clique para filtrar)'">
                    <span class="hb-l">{{ u['uf'] }}</span>
                    <span class="track"><span class="fill" [style.width.%]="pct(u['n'], o['byUf'][0]['n'])"></span></span>
                    <span class="hb-v num">{{ fmtInt(u['n']) }}</span>
                  </button>
                }
              </div>
            </section>
          </div>
        </div>

        <section class="card" style="margin-top:16px" aria-labelledby="h-buy">
          <div class="card-head"><div><h2 id="h-buy">Maiores compradores de software</h2><p>Órgãos com mais contratações no período</p></div></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Órgão</th><th>UF</th><th class="r">Contratações</th><th class="r">Valor estimado</th></tr></thead>
              <tbody>
                @for (b of o['topOrgaos']; track $index) {
                  <tr><td>{{ b['orgao_nome'] }}</td><td>{{ b['uf'] }}</td><td class="r num">{{ fmtInt(b['n']) }}</td><td class="r num">{{ fmtMoney(b['valor']) }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="card" style="margin-top:16px" id="lista" aria-labelledby="h-list">
          <div class="card-head">
            <div class="grow">
              <h2 id="h-list">{{ categoria() ? catLabel() : 'Todas as contratações de software' }}</h2>
              <p>{{ fmtInt(list()?.['total']) }} contratações{{ categoria() ? '' : ' · escolha uma categoria acima para filtrar' }}</p>
            </div>
            @if (categoria()) { <button class="sm" (click)="pick(null)"><app-icon name="x" [size]="13" /> Limpar categoria</button> }
            <form class="search" style="width:260px" (ngSubmit)="loadList(1)" role="search">
              <app-icon name="search" [size]="15" />
              <label class="sr-only" for="mq">Buscar no mercado</label>
              <input id="mq" type="search" name="mq" [(ngModel)]="text" placeholder="Buscar objeto ou órgão" style="height:34px" />
            </form>
            <label class="sr-only" for="msort">Ordenar</label>
            <select id="msort" style="width:170px;height:34px" [ngModel]="sort()" (ngModelChange)="sort.set($event); loadList(1)">
              <option value="valor">Maior valor</option><option value="publicacao">Mais recentes</option><option value="prazo">Prazo mais próximo</option>
            </select>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Objeto</th><th>Órgão</th><th>Categoria</th><th>Situação</th><th class="r">Valor</th><th></th></tr></thead>
              <tbody>
                @for (r of list()?.['rows'] ?? []; track r['control_id']) {
                  <tr>
                    <td style="max-width:460px"><div class="clamp-2" [title]="r['objeto']">{{ r['objeto'] }}</div><div class="muted small">{{ r['modalidade_nome'] }} · publicada {{ fmtDay(r['data_publicacao']) }}</div></td>
                    <td><div>{{ r['orgao_nome'] }}</div><div class="muted small">{{ r['municipio'] }}/{{ r['uf'] }} · {{ r['esfera_label'] }}</div></td>
                    <td><span class="badge plain b-primary">{{ r['category_label'] }}</span></td>
                    <td><span class="badge" [class]="'badge ' + stateTone(r['derived_state'])">{{ r['derived_state'] }}</span>
                      @if (r['encerramento_utc']) { <div class="muted small">até {{ fmtDate(r['encerramento_utc']) }}</div> }</td>
                    <td class="r num">{{ fmtMoney(r['valor_estimado_cents'], r['orcamento_sigiloso']) }}</td>
                    <td><button class="icon sm ghost" (click)="openPncp(r['control_id'])" title="Abrir no PNCP" aria-label="Abrir no PNCP"><app-icon name="external" [size]="14" /></button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <nav class="pager" aria-label="Paginação do mercado">
            <button class="sm" (click)="loadList(listPage() - 1)" [disabled]="listPage() <= 1"><app-icon name="chevronLeft" [size]="14" /> Anterior</button>
            <span class="muted small">Página {{ listPage() }} de {{ listPages() }}</span>
            <button class="sm" (click)="loadList(listPage() + 1)" [disabled]="listPage() >= listPages()">Próxima <app-icon name="chevronRight" [size]="14" /></button>
          </nav>
        </section>

        <p class="muted small" style="margin-top:14px">
          Base: {{ fmtInt(o['analisadasTotal']) }} contratações de software registradas desde {{ fmtDay(o['kpis'].desde) }}.
          A categoria é atribuída pelo objeto da contratação (a primeira que se aplica); confira o edital antes de concluir sobre um mercado.
        </p>
      }
    } @else {
      <div class="kpis">@for (i of [1,2,3,4]; track i) { <div class="kpi"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:28px;width:40%"></div></div> }</div>
    }
  `,
  styles: `
    .toolbar { padding: 12px 16px; margin-bottom: 16px; }
    .divider { width: 1px; height: 20px; background: var(--border); }
    .grid-main { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr); gap: 16px; align-items: start; }
    @media (max-width: 1180px) { .grid-main { grid-template-columns: 1fr; } }
    .ranking { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .rank-row {
      width: 100%; height: auto; display: grid; grid-template-columns: 26px 1fr 150px; align-items: center; gap: 12px;
      padding: 9px 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; box-shadow: none; text-align: left; font-weight: 400;
    }
    .rank-row:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border); }
    .rank-row.sel { background: var(--accent-soft); border-color: var(--accent); }
    .pos { color: var(--faint); font-weight: 600; font-size: 12px; text-align: center; }
    .lbl { display: grid; gap: 6px; min-width: 0; }
    .name { font-size: 13px; font-weight: 600; color: var(--text); display: flex; gap: 8px; align-items: center; }
    .track { display: block; height: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 4px; background: var(--chart); min-width: 3px; transition: width .5s var(--ease); }
    .val { display: grid; justify-items: end; gap: 1px; }
    .val strong { font-size: 14px; }
    .cols { display: flex; align-items: flex-end; gap: 6px; height: 150px; padding-top: 18px; }
    .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 4px; min-width: 0; }
    .c-bar { width: 100%; max-width: 26px; background: var(--chart); border-radius: 4px 4px 0 0; min-height: 3px; transition: height .5s var(--ease); }
    .col:hover .c-bar { filter: brightness(1.15); }
    .c-val { font-size: 10.5px; color: var(--muted); }
    .c-lbl { font-size: 10px; color: var(--faint); white-space: nowrap; }
    .hbar { display: grid; grid-template-columns: 104px 1fr 52px; align-items: center; gap: 10px; padding: 5px 0; font-size: 12.5px; width: 100%; }
    .hbar.as-btn { height: auto; border: 0; background: none; box-shadow: none; font-weight: 400; padding: 5px 4px; border-radius: 8px; text-align: left; }
    .hbar.as-btn:hover:not(:disabled) { background: var(--surface-2); }
    .hb-l { color: var(--text-2); font-weight: 500; }
    .hb-v { text-align: right; font-weight: 600; }
    .pager { display: flex; justify-content: center; align-items: center; gap: 14px; padding: 4px 0 16px; }
  `,
})
export class MarketPage implements OnInit {
  protected readonly api = inject(Api);
  protected readonly ufs = UFS;
  protected readonly esferas = ESFERAS;
  protected readonly periods: [number, string][] = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [0, 'Tudo']];
  protected readonly fmtInt = fmtInt; protected readonly fmtMoney = fmtMoney; protected readonly fmtCompactMoney = fmtCompactMoney;
  protected readonly fmtDate = fmtDate; protected readonly fmtDay = fmtDay; protected readonly stateTone = stateTone;

  protected readonly dias = signal(30);
  protected readonly abertas = signal(false);
  protected readonly esfera = signal<string[]>([]);
  protected readonly uf = signal('');
  protected readonly categoria = signal<string | null>(null);
  protected readonly measure = signal<'n' | 'valor'>('n');
  protected readonly sort = signal<'valor' | 'publicacao' | 'prazo'>('valor');
  protected readonly ov = signal<Row | null>(null);
  protected readonly list = signal<Row | null>(null);
  protected readonly listPage = signal(1);
  protected readonly msg = signal('');
  text = '';
  backfillDays = 30;

  protected readonly categories = computed(() => {
    const cats = (this.ov()?.['byCategory'] ?? []) as Row[];
    const key = this.measure();
    return [...cats].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  });
  protected readonly maxCat = computed(() => Math.max(1, ...this.categories().map((c) => c[this.measure()] ?? 0)));
  protected readonly maxWeek = computed(() => Math.max(1, ...((this.ov()?.['weekly'] ?? []) as Row[]).map((w) => w['n'])));
  protected readonly listPages = computed(() => Math.max(1, Math.ceil((this.list()?.['total'] ?? 0) / 20)));
  protected readonly catLabel = computed(() => (this.ov()?.['byCategory'] as Row[] | undefined)?.find((c) => c['id'] === this.categoria())?.['label'] ?? '');

  ngOnInit(): void { void this.reload(); }

  private base(): Row {
    return { dias: this.dias(), abertas: this.abertas(), esfera: this.esfera(), uf: this.uf() ? [this.uf()] : [] };
  }
  protected async reload(): Promise<void> {
    if (!this.api.available) return;
    this.ov.set(await this.api.raw.market.overview(this.base()));
    await this.loadList(1);
  }
  protected async loadList(page: number): Promise<void> {
    const p = Math.max(1, Math.min(page, this.listPages() || 1));
    this.listPage.set(page < 1 ? 1 : p);
    this.list.set(await this.api.raw.market.list({ ...this.base(), categoria: this.categoria(), text: this.text, sort: this.sort(), page: this.listPage(), pageSize: 20 }));
  }
  protected pick(id: string | null): void {
    this.categoria.set(this.categoria() === id ? null : id);
    void this.loadList(1).then(() => document.getElementById('lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  protected toggleEsfera(e: string): void {
    const cur = this.esfera();
    this.esfera.set(cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]);
    void this.reload();
  }
  protected share(c: Row): number { return Math.round(((c[this.measure()] ?? 0) / this.maxCat()) * 100); }
  protected pct(n: number, max: number): number { return max ? Math.round((n / max) * 100) : 0; }
  protected weekPct(n: number): number { return Math.round((n / this.maxWeek()) * 100); }
  protected fmtWeek(iso: string): string { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''; }
  protected weeklyLabel(): string {
    return 'Contratações por semana: ' + ((this.ov()?.['weekly'] ?? []) as Row[]).map((w) => `${this.fmtWeek(w['inicio'])}: ${w['n']}`).join('; ');
  }
  protected async openPncp(controlId: string): Promise<void> {
    const r = await this.api.raw.open({ kind: 'market', controlId });
    if (!r.ok) this.msg.set(r.reason);
  }
  protected async export(): Promise<void> {
    const r = await this.api.raw.market.export({ ...this.base(), categoria: this.categoria(), text: this.text });
    this.msg.set(r.ok ? `CSV salvo em ${r.path}` : 'Exportação cancelada.');
  }
  protected async backfill(): Promise<void> {
    const n = await this.api.raw.market.backfill({ days: this.backfillDays });
    this.msg.set(`Histórico de ${this.backfillDays} dias enfileirado (${n} janelas). A coleta roda em segundo plano; acompanhe em Fontes e sincronização.`);
  }
}
