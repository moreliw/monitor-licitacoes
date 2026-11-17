import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, LABEL_TEXT, MODALIDADES, Row, UFS, WATCH_TEXT, deadlineTone, fmtDate, fmtDay, fmtInt, fmtMoney, fmtRelative, stateTone } from '../api';
import { Icon } from '../icon';

type Quick = 'todas' | 'abertas' | 'encerram7' | 'alta' | 'acompanhadas';

@Component({
  selector: 'app-opportunities',
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <span class="eyebrow">Software para o Legislativo</span>
        <h1>Oportunidades</h1>
        <p>Licitações de processo legislativo, protocolo, gestão documental, e-SIC e portais para Câmaras e Assembleias de todo o Brasil.</p>
      </div>
      <div class="actions">
        @if (naming()) {
          <form class="row name-form fade-in" (ngSubmit)="confirmSave()">
            <label class="sr-only" for="fname">Nome do filtro</label>
            <input id="fname" type="text" name="fname" [(ngModel)]="filterName" placeholder="Nome do filtro" maxlength="60" style="width:200px" />
            <button class="primary" type="submit" [disabled]="!filterName.trim()">Salvar</button>
            <button type="button" class="ghost" (click)="naming.set(false)">Cancelar</button>
          </form>
        } @else {
          <button (click)="naming.set(true)"><app-icon name="bookmark" [size]="15" /> Salvar filtro</button>
        }
        <button (click)="export()"><app-icon name="download" [size]="15" /> Exportar CSV</button>
      </div>
    </header>

    <section class="kpis" aria-label="Resumo">
      <button class="kpi" [class.active]="quick() === 'abertas'" (click)="setQuick('abertas')">
        <span class="k-label"><span class="k-icon"><app-icon name="target" [size]="15" /></span> Recebendo propostas</span>
        <span class="k-value">{{ fmtInt(s()?.['abertas']) }}</span>
        <span class="k-sub">+ {{ fmtInt(s()?.['futuras']) }} com abertura futura</span>
      </button>
      <button class="kpi" [class.active]="quick() === 'encerram7'" (click)="setQuick('encerram7')">
        <span class="k-label"><span class="k-icon warn"><app-icon name="clock" [size]="15" /></span> Encerram em 7 dias</span>
        <span class="k-value">{{ fmtInt(s()?.['encerram7']) }}</span>
        <span class="k-sub">prazo de propostas próximo</span>
      </button>
      <button class="kpi" [class.active]="quick() === 'alta'" (click)="setQuick('alta')">
        <span class="k-label"><span class="k-icon ok"><app-icon name="sparkles" [size]="15" /></span> Alta relevância</span>
        <span class="k-value">{{ fmtInt(s()?.['alta']) }}</span>
        <span class="k-sub">{{ fmtInt(s()?.['revisar']) }} para revisar · {{ fmtInt(s()?.['pendente']) }} pendentes</span>
      </button>
      <button class="kpi" [class.active]="quick() === 'acompanhadas'" (click)="setQuick('acompanhadas')">
        <span class="k-label"><span class="k-icon"><app-icon name="bookmark" [size]="15" /></span> Acompanhadas</span>
        <span class="k-value">{{ fmtInt(s()?.['watched']) }}</span>
        <span class="k-sub">com lembretes de prazo</span>
      </button>
    </section>

    <section class="card toolbar" aria-label="Filtros">
      <div class="row tb-main">
        <form class="search grow" (ngSubmit)="search()" role="search">
          <app-icon name="search" [size]="16" />
          <label class="sr-only" for="q">Buscar</label>
          <input id="q" type="search" name="q" [(ngModel)]="text" (ngModelChange)="debounced()" placeholder="Buscar por órgão, município, objeto, itens ou texto do edital" autocomplete="off" />
        </form>
        <label class="sr-only" for="uf">UF</label>
        <select id="uf" class="uf" [(ngModel)]="uf" (ngModelChange)="search()">
          <option value="">Todas as UFs</option>
          @for (u of ufs; track u) { <option [value]="u">{{ u }}</option> }
        </select>
        <label class="sr-only" for="sort">Ordenar por</label>
        <select id="sort" class="sort" [(ngModel)]="sort" (ngModelChange)="search()">
          <option value="relevancia">Mais relevantes</option>
          <option value="prazo">Prazo mais próximo</option>
          <option value="publicacao">Publicação mais recente</option>
          <option value="valor">Maior orçamento</option>
          <option value="orgao">Órgão (A–Z)</option>
        </select>
        <button class="icon" [class.on]="more()" (click)="more.set(!more())" [attr.aria-expanded]="more()" aria-label="Mais filtros" title="Mais filtros"><app-icon name="filter" [size]="16" /></button>
      </div>
      <div class="row chips-row">
        <span class="muted small">Relevância</span>
        <div class="chips">
          @for (r of relevancias; track r[0]) {
            <button class="chip" [attr.aria-pressed]="relevancia.includes(r[0])" (click)="toggle(relevancia, r[0])">
              <span class="dot" [class]="'dot d-' + r[0]"></span>{{ r[1] }}
            </button>
          }
        </div>
        <span class="divider"></span>
        <span class="muted small">Situação</span>
        <div class="chips">
          @for (st of estados; track st) {
            <button class="chip" [attr.aria-pressed]="estado.includes(st)" (click)="toggle(estado, st)">{{ st }}</button>
          }
        </div>
        @if (hasFilters()) { <button class="link small right" (click)="clear()">Limpar filtros</button> }
      </div>
      @if (more()) {
        <div class="row more fade-in">
          <div class="chips">
            <span class="muted small">Modalidade</span>
            @for (m of modalidades; track m[0]) {
              <button class="chip" [attr.aria-pressed]="modalidade.includes(m[0])" (click)="toggle(modalidade, m[0])">{{ m[1] }}</button>
            }
          </div>
          <label class="sr-only" for="saved">Filtros salvos</label>
          <select id="saved" class="saved right" [(ngModel)]="savedId" (ngModelChange)="applySaved()">
            <option [ngValue]="null">Filtros salvos…</option>
            @for (f of saved(); track f['id']) { <option [ngValue]="f['id']">{{ f['name'] }}</option> }
          </select>
          @if (savedId) { <button class="sm ghost danger" (click)="deleteSaved()">Excluir</button> }
        </div>
      }
    </section>

    @if (error()) { <div class="banner bad"><app-icon name="alert" /> {{ error() }}</div> }
    @if (info()) { <div class="banner info"><app-icon name="info" /> {{ info() }}</div> }

    <div class="list-head">
      <strong aria-live="polite">{{ fmtInt(total()) }} {{ total() === 1 ? 'oportunidade' : 'oportunidades' }}</strong>
      @if (lastRun(); as lr) {
        @if (lr['stats'].discarded !== undefined) {
          <span class="muted small">· última coleta analisou {{ fmtInt(lr['stats'].records) }} contratações e descartou {{ fmtInt(lr['stats'].discarded) }} fora do nicho</span>
        }
      }
    </div>

    @if (loading() && rows().length === 0) {
      <div class="list">@for (i of [1,2,3,4]; track i) { <div class="item skel"><div class="skeleton" style="height:16px;width:60%"></div><div class="skeleton" style="height:12px;width:40%;margin-top:10px"></div></div> }</div>
    } @else if (rows().length === 0) {
      <div class="card empty">
        <div class="e-icon"><app-icon name="inbox" [size]="26" /></div>
        @if (!hasFilters() && quick() === 'todas') {
          <h2>Nenhuma oportunidade ainda</h2>
          <p>A coleta analisa todas as contratações do PNCP e guarda só as do nicho. Ela continua em segundo plano.</p>
          <button class="primary" (click)="api.raw?.sync.run()"><app-icon name="refresh" [size]="15" /> Sincronizar agora</button>
        } @else {
          <h2>Nada encontrado com esses filtros</h2>
          <button (click)="clear()">Limpar filtros</button>
        }
      </div>
    } @else {
      <div class="list" [class.dim]="loading()">
        @for (r of rows(); track r['id']) {
          <article class="item" [class]="'item rel-' + r['relevance']">
            <button class="star" [class.on]="!!r['favorito']" (click)="toggleFav(r)" [attr.aria-pressed]="!!r['favorito']" [attr.aria-label]="r['favorito'] ? 'Remover dos favoritos' : 'Favoritar'">
              <app-icon name="star" [size]="17" />
            </button>
            <a class="main" [routerLink]="['/oportunidade', r['id']]">
              <div class="row tags">
                <span class="badge" [class]="'badge b-' + r['relevance']">{{ labelText[r['relevance']] }}</span>
                <span class="badge" [class]="'badge ' + stateTone(r['derived_state'])">{{ r['derived_state'] }}</span>
                @if (r['watch_status']) { <span class="badge plain b-primary"><app-icon name="bookmark" [size]="11" /> {{ watchText[r['watch_status']] }}</span> }
                @if (r['manual']) { <span class="small muted">decisão manual</span> }
              </div>
              <h3 class="obj clamp-2" [title]="r['objeto']">{{ r['objeto'] }}</h3>
              <div class="meta">
                <span><app-icon name="building" [size]="13" /> {{ r['orgao_nome'] }}</span>
                <span><app-icon name="pin" [size]="13" /> {{ r['municipio'] }}/{{ r['uf'] }}</span>
                <span>{{ r['modalidade_nome'] }}</span>
                <span>Publicada {{ fmtDay(r['data_publicacao']) }}</span>
              </div>
            </a>
            <div class="side-info">
              <div class="deadline" [class]="'deadline t-' + deadlineTone(r['encerramento_utc'], r['derived_state'])">
                <span class="dl-label">Propostas até</span>
                <strong class="num">{{ fmtDate(r['encerramento_utc']) }}</strong>
                @if (r['derived_state'] === 'Recebendo propostas') { <span class="dl-rel">{{ fmtRelative(r['encerramento_utc']) }}</span> }
              </div>
              <div class="value num">{{ fmtMoney(r['valor_estimado_cents'], r['orcamento_sigiloso']) }}</div>
            </div>
          </article>
        }
      </div>
      <nav class="pager" aria-label="Paginação">
        <button class="sm" (click)="goto(page() - 1)" [disabled]="page() <= 1"><app-icon name="chevronLeft" [size]="14" /> Anterior</button>
        <span class="muted small">Página {{ page() }} de {{ pages() }}</span>
        <button class="sm" (click)="goto(page() + 1)" [disabled]="page() >= pages()">Próxima <app-icon name="chevronRight" [size]="14" /></button>
      </nav>
    }
  `,
  styles: `
    .k-icon.warn { background: var(--warn-soft); color: var(--warn); }
    .k-icon.ok { background: var(--ok-soft); color: var(--ok); }
    .toolbar { padding: 14px 16px; display: grid; gap: 12px; margin-bottom: 16px; }
    .tb-main { gap: 8px; flex-wrap: nowrap; }
    .uf { width: 150px; height: 40px; }
    .sort { width: 210px; height: 40px; }
    .tb-main > button.icon { height: 40px; width: 40px; }
    button.icon.on { background: var(--primary-soft); color: var(--primary-ink); border-color: var(--primary); }
    .chips-row { gap: 8px; }
    .divider { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
    .more { padding-top: 10px; border-top: 1px dashed var(--border); }
    .saved { width: 220px; }
    .dot.d-alta { background: var(--ok); } .dot.d-revisar { background: var(--warn); } .dot.d-pendente { background: var(--info); } .dot.d-fora { background: var(--neutral); }
    .list-head { display: flex; align-items: baseline; gap: 6px; margin: 4px 2px 10px; }
    .list { display: grid; gap: 10px; transition: opacity .2s; }
    .list.dim { opacity: .6; }
    .item {
      position: relative; display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: start;
      background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 15px 18px 15px 14px;
      box-shadow: var(--shadow-sm); transition: border-color .15s var(--ease), box-shadow .15s var(--ease), transform .15s var(--ease);
    }
    .item::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; border-radius: 0 3px 3px 0; background: var(--neutral-soft); }
    .item.rel-alta::before { background: var(--ok); } .item.rel-revisar::before { background: var(--warn); } .item.rel-pendente::before { background: var(--info); }
    .item:hover { border-color: var(--border-strong); box-shadow: var(--shadow); transform: translateY(-1px); }
    .item.skel { display: block; padding: 20px; }
    .main { color: inherit; text-decoration: none; display: grid; gap: 7px; min-width: 0; }
    .main:hover { text-decoration: none; }
    .main:hover .obj { color: var(--primary-ink); }
    .tags { gap: 6px; }
    .obj { font-family: var(--font); font-size: 14.5px; font-weight: 600; color: var(--text); line-height: 1.4; transition: color .15s; }
    .meta { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--muted); font-size: 12.5px; }
    .meta span { display: inline-flex; align-items: center; gap: 5px; }
    .star { width: 32px; height: 32px; padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--faint); margin-top: 1px; }
    .star:hover:not(:disabled) { background: var(--surface-3); color: var(--warn); }
    .star.on { color: #f5b301; }
    .star.on ::ng-deep svg { fill: #f5b301; }
    .side-info { display: grid; gap: 8px; justify-items: end; text-align: right; min-width: 170px; }
    .deadline { display: grid; justify-items: end; gap: 1px; padding: 7px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
    .dl-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 650; }
    .deadline strong { font-size: 13px; }
    .dl-rel { font-size: 11.5px; font-weight: 650; }
    .t-bad { background: var(--bad-soft); border-color: transparent; } .t-bad .dl-rel { color: var(--bad); }
    .t-warn { background: var(--warn-soft); border-color: transparent; } .t-warn .dl-rel { color: var(--warn); }
    .t-ok .dl-rel { color: var(--ok); }
    .value { font-weight: 650; font-size: 13.5px; color: var(--text-2); }
    .pager { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 18px; }
  `,
})
export class OpportunitiesPage implements OnInit, OnDestroy {
  protected readonly api = inject(Api);
  protected readonly ufs = UFS;
  protected readonly estados = ['Recebendo propostas', 'Abertura futura', 'Prazo encerrado', 'Sem prazo confirmado', 'Suspensa'];
  protected readonly modalidades = Object.entries(MODALIDADES).map(([k, v]) => [Number(k), v] as [number, string]);
  protected readonly relevancias = Object.entries(LABEL_TEXT).filter(([k]) => k !== 'fora');
  protected readonly labelText = LABEL_TEXT;
  protected readonly watchText = WATCH_TEXT;
  protected readonly fmtDate = fmtDate; protected readonly fmtDay = fmtDay; protected readonly fmtMoney = fmtMoney;
  protected readonly fmtRelative = fmtRelative; protected readonly fmtInt = fmtInt; protected readonly deadlineTone = deadlineTone; protected readonly stateTone = stateTone;

  text = ''; uf = ''; modalidade: number[] = []; relevancia: string[] = []; estado: string[] = [];
  savedId: number | null = null; sort = 'relevancia';
  protected readonly quick = signal<Quick>('todas');
  protected readonly more = signal(false);
  protected readonly rows = signal<Row[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = 20;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');
  protected readonly saved = signal<Row[]>([]);
  protected readonly s = computed(() => this.api.stats());
  protected readonly lastRun = computed(() => this.api.status()?.['overview']?.lastRun ?? null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private typing: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => { this.api.progress(); this.api.alertsVersion(); untracked(() => this.scheduleReload()); });
  }
  private scheduleReload(): void {
    if (!this.api.available || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.load(); }, 3000);
  }
  ngOnInit(): void { if (this.api.available) { void this.load(); void this.loadSaved(); } }
  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); if (this.typing) clearTimeout(this.typing); }

  protected filter(): Row {
    const q = this.quick();
    return {
      text: this.text, uf: this.uf ? [this.uf] : [], modalidade: this.modalidade, relevancia: q === 'alta' ? ['alta'] : this.relevancia,
      estado: q === 'abertas' ? ['Recebendo propostas'] : this.estado, prazoDias: q === 'encerram7' ? 7 : null,
      watch: q === 'acompanhadas' ? 'acompanhadas' : 'todas', sort: this.sort, dir: this.sort === 'prazo' || this.sort === 'orgao' ? 'asc' : 'desc',
      page: this.page(), pageSize: this.pageSize,
    };
  }
  protected hasFilters(): boolean { return !!(this.text || this.uf || this.modalidade.length || this.relevancia.length || this.estado.length || this.quick() !== 'todas'); }
  protected setQuick(q: Quick): void { this.quick.set(this.quick() === q ? 'todas' : q); this.search(); }
  protected toggle<T>(arr: T[], v: T): void { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); this.search(); }
  protected debounced(): void { if (this.typing) clearTimeout(this.typing); this.typing = setTimeout(() => this.search(), 300); }
  protected search(): void { this.page.set(1); void this.load(); }
  protected clear(): void {
    this.text = ''; this.uf = ''; this.modalidade = []; this.relevancia = []; this.estado = []; this.savedId = null; this.quick.set('todas');
    this.search();
  }
  protected goto(p: number): void { this.page.set(Math.min(this.pages(), Math.max(1, p))); void this.load(); document.getElementById('conteudo')?.scrollTo({ top: 0, behavior: 'smooth' }); }

  protected async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { const r = await this.api.raw.opps.list(this.filter()); this.rows.set(r.rows); this.total.set(r.total); }
    catch (e) { this.error.set('Falha ao consultar o acervo local: ' + (e as Error).message); }
    this.loading.set(false);
  }
  protected async toggleFav(r: Row): Promise<void> {
    await this.api.raw.watch.set({ id: r['id'], patch: { favorito: !r['favorito'] } });
    await this.load(); void this.api.refreshStats();
  }
  protected async loadSaved(): Promise<void> { this.saved.set(await this.api.raw.filters.list()); }
  protected applySaved(): void {
    const f = this.saved().find((x) => x['id'] === this.savedId)?.['filter'];
    if (!f) return;
    this.text = f.text ?? ''; this.uf = f.uf?.[0] ?? ''; this.modalidade = f.modalidade ?? []; this.relevancia = f.relevancia ?? [];
    this.estado = f.estado ?? []; this.quick.set('todas'); this.search();
  }
  protected readonly naming = signal(false);
  filterName = '';
  protected async confirmSave(): Promise<void> {
    const name = this.filterName.trim();
    if (!name) return;
    await this.api.raw.filters.save({ name, filter: this.filter() });
    await this.loadSaved(); this.naming.set(false); this.filterName = '';
    this.info.set(`Filtro “${name}” salvo. Encontre-o em “Mais filtros”.`);
  }
  protected async deleteSaved(): Promise<void> {
    if (!this.savedId) return;
    await this.api.raw.filters.delete(this.savedId); this.savedId = null; await this.loadSaved();
  }
  protected async export(): Promise<void> {
    const r = await this.api.raw.opps.export(this.filter());
    this.info.set(r.ok ? `CSV salvo em ${r.path}` : 'Exportação cancelada.');
  }
}
