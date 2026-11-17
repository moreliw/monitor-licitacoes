import { Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { Api, MODALIDADES, Row, fmtDate, fmtInt, fmtRelative } from '../api';
import { Icon } from '../icon';

@Component({
  selector: 'app-sources',
  imports: [Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <h1>Fontes e sincronização</h1>
        <p>Saúde da coleta do PNCP, janelas pendentes, falhas e histórico de execuções.</p>
      </div>
      <div class="actions">
        @if (running()) { <button (click)="cancel()"><app-icon name="x" [size]="15" /> Cancelar</button> }
        <button class="primary" (click)="run()" [disabled]="running()"><app-icon name="refresh" [size]="15" /> Sincronizar agora</button>
      </div>
    </header>
    @if (msg()) { <div class="banner info" style="margin-bottom:14px"><app-icon name="info" /> {{ msg() }}</div> }

    @for (s of overview()?.['sources'] ?? []; track s['id']) {
      <section class="card status-hero" [class.warn]="s['stale']">
        <div class="grow">
          <div class="row" style="gap:8px"><h2>{{ s['label'] }}</h2>
            <span class="badge" [class]="s['stale'] ? 'badge b-warn' : 'badge b-ok'">{{ s['stale'] ? 'Base desatualizada' : 'Coleta em dia' }}</span></div>
          <p class="muted">{{ s['coverage'] }} · horizonte de propostas abertas: {{ s['horizonDays'] }} dias</p>
        </div>
      </section>

      <section class="kpis">
        <div class="kpi"><span class="k-label">Última coleta completa</span><span class="k-value sm">{{ s['lastFullSync'] ? fmtRelative(s['lastFullSync']) : 'nunca' }}</span><span class="k-sub">{{ s['lastFullSync'] ? fmtDate(s['lastFullSync']) : 'primeira carga em andamento' }}</span></div>
        <div class="kpi"><span class="k-label">Janelas pendentes</span><span class="k-value">{{ fmtInt(s['pendingWindows']) }}</span><span class="k-sub">histórico pendente: {{ fmtInt(s['historicalPending']) }}</span></div>
        <div class="kpi"><span class="k-label">Falhas</span><span class="k-value" [class.bad]="s['failedJobs']">{{ fmtInt(s['failedJobs']) }}</span>
          <span class="k-sub">@if (s['failedJobs']) { <button class="link small" (click)="resetFailed()">Reprocessar falhas</button> } @else { nenhuma no momento }</span></div>
        <div class="kpi"><span class="k-label">Anexos</span><span class="k-value">{{ fmtInt(s['docsWaiting']) }}</span><span class="k-sub">aguardando leitura · {{ fmtInt(s['docsImageOnly']) }} sem texto</span></div>
      </section>
    }

    <section class="card pad" style="margin-bottom:16px">
      <div class="row">
        <div class="grow"><h2>Carga histórica e regras</h2><p class="muted small">A carga histórica tem prioridade baixa e nunca atrasa a coleta de novidades.</p></div>
        <button (click)="historical()"><app-icon name="layers" [size]="15" /> Buscar histórico ({{ historicoDias }} dias)</button>
        <button (click)="pauseHist(true)">Pausar</button>
        <button (click)="pauseHist(false)">Retomar</button>
        <button (click)="reclassify()"><app-icon name="sparkles" [size]="15" /> Reprocessar relevância</button>
      </div>
    </section>

    @if (api.progress()?.['running']) {
      <section class="card pad live" style="margin-bottom:16px">
        <div class="row"><span class="pulse"></span><strong>Em andamento</strong><span class="muted small">{{ api.progress()?.['message'] }}</span></div>
        @if (api.progress()?.['totalPages']) {
          <div class="bar"><span [style.width.%]="(api.progress()?.['page'] / api.progress()?.['totalPages']) * 100"></span></div>
          <p class="muted small">Página {{ api.progress()?.['page'] }} de {{ api.progress()?.['totalPages'] }}</p>
        }
      </section>
    }

    <div class="two">
      <section class="card">
        <div class="card-head"><h2 class="grow">Fila</h2><span class="muted small">{{ jobs().length }} itens</span></div>
        <div class="table-wrap" style="max-height:320px">
          @if (jobs().length === 0) { <p class="muted">Nada pendente.</p> } @else {
            <table><thead><tr><th>Partição</th><th>Estado</th><th class="r">Tent.</th><th>Último erro</th></tr></thead>
              <tbody>@for (j of jobs(); track j['id']) {
                <tr><td class="mono">{{ j['partition_key'] }}</td><td><span class="badge" [class]="'badge ' + jobClass(j)">{{ jobText(j['status']) }}</span></td>
                  <td class="r num">{{ j['attempts'] }}</td><td class="small muted">{{ j['last_error'] }}</td></tr>
              }</tbody></table>
          }
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2 class="grow">Execuções</h2></div>
        <div class="table-wrap" style="max-height:320px">
          <table><thead><tr><th>Início</th><th>Gatilho</th><th>Estado</th><th class="r">Analisadas</th><th class="r">Software</th><th class="r">Nicho</th></tr></thead>
            <tbody>@for (r of runs(); track r['id']) {
              <tr><td class="num nowrap">{{ fmtDate(r['started_at']) }}</td><td>{{ r['trigger'] }}</td>
                <td><span class="badge" [class]="r['status'] === 'concluido' ? 'badge b-ok' : r['status'] === 'erro' ? 'badge b-bad' : 'badge b-neutral'">{{ r['status'] }}</span></td>
                <td class="r num">{{ fmtInt(r['stats'].records) }}</td><td class="r num">{{ r['stats'].software ?? '—' }}</td>
                <td class="r num">{{ r['stats'].discarded !== undefined ? fmtInt(r['stats'].records - r['stats'].discarded) : '—' }}</td></tr>
            }</tbody></table>
        </div>
      </section>
    </div>

    <section class="card" style="margin-top:16px">
      <div class="card-head">
        <h2 class="grow">Registro</h2>
        <div class="segmented" role="group" aria-label="Nível">
          @for (l of levels; track l[0]) { <button [attr.aria-pressed]="level === l[0]" (click)="setLevel(l[0])">{{ l[1] }}</button> }
        </div>
      </div>
      <div class="table-wrap" style="max-height:360px">
        <table><thead><tr><th>Quando</th><th>Nível</th><th>Rota</th><th>Mensagem</th></tr></thead>
          <tbody>@for (l of logs(); track l['id']) {
            <tr><td class="num small nowrap">{{ fmtDate(l['ts']) }}</td>
              <td><span class="badge" [class]="'badge ' + (l['level'] === 'error' ? 'b-bad' : l['level'] === 'warn' ? 'b-warn' : 'b-neutral')">{{ l['level'] === 'error' ? 'erro' : l['level'] === 'warn' ? 'aviso' : 'info' }}</span></td>
              <td class="mono small">{{ l['route'] || l['window'] || '—' }}</td><td>{{ l['message'] }}</td></tr>
          }</tbody></table>
      </div>
    </section>
    <p class="muted small" style="margin-top:12px">Modalidades: {{ modNames() }}. Fontes complementares (Câmaras, diários oficiais) chegam numa próxima versão.</p>
  `,
  styles: `
    .status-hero { display: flex; gap: 16px; align-items: center; padding: 18px 20px; margin-bottom: 16px; }
    .k-value.sm { font-size: 22px; }
    .k-value.bad { color: var(--bad); }
    .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
    @media (max-width: 1150px) { .two { grid-template-columns: 1fr; } }
    .live { display: grid; gap: 10px; }
    .pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .bar { height: 6px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); transition: width .4s var(--ease); }
  `,
})
export class SourcesPage implements OnInit {
  protected readonly api = inject(Api);
  protected readonly fmtDate = fmtDate; protected readonly fmtInt = fmtInt; protected readonly fmtRelative = fmtRelative;
  protected readonly overview = signal<Row | null>(null);
  protected readonly jobs = signal<Row[]>([]);
  protected readonly runs = signal<Row[]>([]);
  protected readonly logs = signal<Row[]>([]);
  protected readonly msg = signal('');
  protected readonly running = signal(false);
  protected readonly levels: [string, string][] = [['', 'Todos'], ['error', 'Erros'], ['warn', 'Avisos'], ['info', 'Info']];
  protected historicoDias = 90;
  protected level = '';
  private last = 0;

  constructor() {
    effect(() => {
      const p = this.api.progress();
      untracked(() => {
        this.running.set(!!p?.['running']);
        if (Date.now() - this.last > 4000 || !p?.['running']) { this.last = Date.now(); void this.load(); }
      });
    });
  }
  ngOnInit(): void { void this.load(); void this.api.raw?.settings.get().then((s: Row) => (this.historicoDias = s['historicoDias'])); }

  protected modNames(): string { return ((this.overview()?.['sources']?.[0]?.['modalidades'] ?? []) as number[]).map((m) => MODALIDADES[m] ?? m).join(', '); }
  protected jobClass(j: Row): string { return j['status'] === 'erro_permanente' ? 'b-bad' : j['status'] === 'erro' ? 'b-warn' : j['status'] === 'executando' ? 'b-info' : 'b-neutral'; }
  protected jobText(s: string): string { return ({ erro_permanente: 'erro permanente', erro: 'nova tentativa', executando: 'executando', pendente: 'na fila' } as Record<string, string>)[s] ?? s; }
  protected async load(): Promise<void> {
    if (!this.api.available) return;
    const [o, j, r, l] = await Promise.all([this.api.raw.sources.overview(), this.api.raw.sources.jobs(), this.api.raw.sources.runs(), this.api.raw.sources.logs(this.level || null)]);
    this.overview.set(o); this.jobs.set(j); this.runs.set(r); this.logs.set(l);
  }
  protected setLevel(v: string): void { this.level = v; void this.load(); }
  protected async run(): Promise<void> { await this.api.raw.sync.run(); }
  protected async cancel(): Promise<void> { await this.api.raw.sync.cancel(); }
  protected async resetFailed(): Promise<void> { const n = await this.api.raw.sync.resetFailed(); this.msg.set(`${n} itens voltaram para a fila.`); await this.load(); }
  protected async historical(): Promise<void> { const n = await this.api.raw.sync.historical({ days: this.historicoDias }); this.msg.set(`${n} janelas históricas enfileiradas (prioridade baixa; pode pausar).`); }
  protected async pauseHist(p: boolean): Promise<void> { await this.api.raw.sync.pauseHistorical(p); this.msg.set(p ? 'Carga histórica pausada.' : 'Carga histórica retomada.'); }
  protected async reclassify(): Promise<void> { const n = await this.api.raw.sync.reclassify(); this.msg.set(`${n} oportunidades reclassificadas (decisões manuais preservadas).`); void this.api.refreshStats(); }
}
