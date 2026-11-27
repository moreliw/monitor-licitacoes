import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AGIL_CHIP, AGIL_TEXT, Api, LABEL_TEXT, MODALIDADES, Row, UFS, WATCH_TEXT, agilTone, deadlineTone, fmtDate, fmtDay, fmtInt, fmtMoney, fmtRelative, stateTone } from '../api';
import { Icon } from '../icon';

type Quick = 'todas' | 'abertas' | 'encerram7' | 'agil' | 'acompanhadas';

@Component({
  selector: 'app-opportunities',
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <h1>Oportunidades</h1>
        <p>Licitações de processo legislativo, plenário, protocolo, gestão documental e portais para Câmaras e Assembleias de todo o Brasil, com a aderência de cada uma ao Ágil.</p>
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
        <span class="k-label">Recebendo propostas</span>
        <span class="k-value">{{ fmtInt(s()?.['abertas']) }}</span>
        <span class="k-sub">+ {{ fmtInt(s()?.['futuras']) }} com abertura futura</span>
      </button>
      <button class="kpi" [class.active]="quick() === 'encerram7'" (click)="setQuick('encerram7')">
        <span class="k-label">Encerram em 7 dias</span>
        <span class="k-value">{{ fmtInt(s()?.['encerram7']) }}</span>
        <span class="k-sub">prazo de propostas próximo</span>
      </button>
      <button class="kpi" [class.active]="quick() === 'agil'" (click)="setQuick('agil')">
        <span class="k-label">Alvos do Ágil abertos</span>
        <span class="k-value">{{ fmtInt(s()?.['alvosAbertos']) }}</span>
        <span class="k-sub">+ {{ fmtInt(s()?.['condicionadasAbertas']) }} condicionadas · {{ fmtInt(s()?.['alta']) }} de alta relevância</span>
      </button>
      <button class="kpi" [class.active]="quick() === 'acompanhadas'" (click)="setQuick('acompanhadas')">
        <span class="k-label">Acompanhadas</span>
        <span class="k-value">{{ fmtInt(s()?.['watched']) }}</span>
        <span class="k-sub">com lembretes de prazo</span>
      </button>
    </section>

    <section class="filters" aria-label="Filtros">
      <div class="row tb-main">
        <form class="search grow" (ngSubmit)="search()" role="search">
          <app-icon name="search" [size]="15" />
          <label class="sr-only" for="q">Buscar</label>
          <input id="q" type="search" name="q" [(ngModel)]="text" (ngModelChange)="debounced()" placeholder="Buscar órgão, município, objeto, item ou trecho do edital" autocomplete="off" />
        </form>
        <label class="sr-only" for="uf">UF</label>
        <select id="uf" class="uf" [(ngModel)]="uf" (ngModelChange)="search()">
          <option value="">Todas as UFs</option>
          @for (u of ufs; track u) { <option [value]="u">{{ u }}</option> }
        </select>
        <label class="sr-only" for="sort">Ordenar por</label>
        <select id="sort" class="sort" [(ngModel)]="sort" (ngModelChange)="search()">
          <option value="agil">Aderência ao Ágil</option>
          <option value="relevancia">Mais relevantes</option>
          <option value="prazo">Prazo mais próximo</option>
          <option value="publicacao">Mais recentes</option>
          <option value="valor">Maior orçamento</option>
          <option value="orgao">Órgão (A–Z)</option>
        </select>
        <button [class.on]="more()" (click)="more.set(!more())" [attr.aria-expanded]="more()"><app-icon name="filter" [size]="14" /> Filtros</button>
      </div>
      <div class="row chips-row">
        <div class="chips" role="group" aria-label="Relevância">
          @for (r of relevancias; track r[0]) {
            <button class="chip" [attr.aria-pressed]="relevancia.includes(r[0])" (click)="toggle(relevancia, r[0])">{{ r[1] }}</button>
          }
        </div>
        <span class="divider"></span>
        <div class="chips" role="group" aria-label="Aderência ao Ágil">
          @for (a of aderencias; track a[0]) {
            <button class="chip" [attr.aria-pressed]="aderencia.includes(a[0])" (click)="toggle(aderencia, a[0])">{{ a[1] }}</button>
          }
        </div>
        <span class="divider"></span>
        <div class="chips" role="group" aria-label="Situação">
          @for (st of estados; track st) {
            <button class="chip" [attr.aria-pressed]="estado.includes(st)" (click)="toggle(estado, st)">{{ st }}</button>
          }
        </div>
        @if (hasFilters()) { <button class="link small right" (click)="clear()">Limpar filtros</button> }
      </div>
      @if (more()) {
        <div class="row more fade-in">
          <span class="muted small">Modalidade</span>
          <div class="chips">
            @for (m of modalidades; track m[0]) {
              <button class="chip" [attr.aria-pressed]="modalidade.includes(m[0])" (click)="toggle(modalidade, m[0])">{{ m[1] }}</button>
            }
          </div>
          <label class="check-inline"><input type="checkbox" [(ngModel)]="incluirFora" (ngModelChange)="search()" /> Mostrar também fora do perfil</label>
          <label class="sr-only" for="saved">Filtros salvos</label>
          <select id="saved" class="saved right" [(ngModel)]="savedId" (ngModelChange)="applySaved()">
            <option [ngValue]="null">Filtros salvos</option>
            @for (f of saved(); track f['id']) { <option [ngValue]="f['id']">{{ f['name'] }}</option> }
          </select>
          @if (savedId) { <button class="sm ghost danger" (click)="deleteSaved()">Excluir</button> }
        </div>
      }
    </section>

    @if (error()) { <div class="banner bad"><app-icon name="alert" /> {{ error() }}</div> }
    @if (info()) { <div class="banner info"><app-icon name="info" /> {{ info() }}</div> }

    <div class="card list-card">
      <div class="list-head">
        <span aria-live="polite"><strong>{{ fmtInt(total()) }}</strong><span class="muted">&nbsp;{{ total() === 1 ? 'oportunidade' : 'oportunidades' }}</span></span>
        @if (lastRun(); as lr) {
          @if (lr['stats'].discarded !== undefined) {
            <span class="muted small right">Última coleta: {{ fmtInt(lr['stats'].records) }} analisadas, {{ fmtInt(lr['stats'].discarded) }} fora do nicho</span>
          }
        }
      </div>

      @if (loading() && rows().length === 0) {
        @for (i of [1,2,3,4]; track i) { <div class="item skel"><div class="skeleton" style="height:14px;width:55%"></div><div class="skeleton" style="height:12px;width:35%;margin-top:10px"></div></div> }
      } @else if (rows().length === 0) {
        <div class="empty">
          <div class="e-icon"><app-icon name="inbox" [size]="20" /></div>
          @if (!hasFilters() && quick() === 'todas') {
            <h2>Nenhuma oportunidade ainda</h2>
            <p>A coleta analisa todas as contratações do PNCP e guarda só as do nicho. Ela continua em segundo plano.</p>
            <button class="primary" (click)="api.raw?.sync.run()">Sincronizar agora</button>
          } @else {
            <h2>Nada encontrado</h2>
            <p>Nenhuma oportunidade corresponde aos filtros atuais.</p>
            <button (click)="clear()">Limpar filtros</button>
          }
        </div>
      } @else {
        <div class="list" [class.dim]="loading()">
          @for (r of rows(); track r['id']) {
            <article class="item">
              <button class="star" [class.on]="!!r['favorito']" (click)="toggleFav(r)" [attr.aria-pressed]="!!r['favorito']" [attr.aria-label]="r['favorito'] ? 'Remover dos favoritos' : 'Favoritar'">
                <app-icon name="star" [size]="15" [stroke]="1.75" />
              </button>
              <a class="main" [routerLink]="['/oportunidade', r['id']]">
                <span class="obj clamp-2" [title]="r['objeto']">{{ r['objeto'] }}</span>
                <span class="meta">
                  <span class="org ellipsis">{{ r['orgao_nome'] }}</span>
                  <span class="sep">·</span><span>{{ r['municipio'] }}/{{ r['uf'] }}</span>
                  <span class="sep">·</span><span>{{ r['modalidade_nome'] }}</span>
                  <span class="sep">·</span><span>publicada {{ fmtDay(r['data_publicacao']) }}</span>
                </span>
                <span class="tags">
                  @if (r['agil_aderencia']) { <span class="badge" [class]="'badge ' + agilTone(r['agil_aderencia'])" [title]="r['agil_resumo']">{{ agilText[r['agil_aderencia']] }}{{ r['agil_aderencia'] !== 'fora' ? ' · ' + r['agil_score'] : '' }}</span> }
                  <span class="badge" [class]="'badge b-' + r['relevance']">{{ labelText[r['relevance']] }}</span>
                  <span class="badge" [class]="'badge ' + stateTone(r['derived_state'])">{{ r['derived_state'] }}</span>
                  @if (r['watch_status']) { <span class="badge b-primary">{{ watchText[r['watch_status']] }}</span> }
                  @if (r['manual']) { <span class="small muted">decisão manual</span> }
                  @if (r['republicacoes']) { <span class="badge b-neutral" title="A mesma compra foi publicada mais de uma vez no PNCP">+{{ r['republicacoes'] }} republicação</span> }
                  @if (r['datas_a_conferir']) { <span class="badge b-warn" title="Publicação posterior ao encerramento: confira as datas no edital">Datas a conferir</span> }
                </span>
              </a>
              <div class="side-info">
                <span class="dl-date num">{{ fmtDate(r['encerramento_utc']) }}</span>
                @if (r['derived_state'] === 'Recebendo propostas') {
                  <span class="dl-rel" [class]="'dl-rel t-' + deadlineTone(r['encerramento_utc'], r['derived_state'])">encerra {{ fmtRelative(r['encerramento_utc']) }}</span>
                } @else { <span class="dl-rel muted">prazo de propostas</span> }
                <span class="value num">{{ fmtMoney(r['valor_estimado_cents'], r['orcamento_sigiloso']) }}</span>
              </div>
            </article>
          }
        </div>
        <nav class="pager" aria-label="Paginação">
          <span class="muted small">Página {{ page() }} de {{ pages() }}</span>
          <span class="right row" style="gap:6px">
            <button class="sm" (click)="goto(page() - 1)" [disabled]="page() <= 1" aria-label="Página anterior"><app-icon name="chevronLeft" [size]="14" /> Anterior</button>
            <button class="sm" (click)="goto(page() + 1)" [disabled]="page() >= pages()" aria-label="Próxima página">Próxima <app-icon name="chevronRight" [size]="14" /></button>
          </span>
        </nav>
      }
    </div>
  `,
  styles: `
    .filters { display: grid; gap: 12px; margin-bottom: 16px; }
    .tb-main { gap: 8px; flex-wrap: nowrap; }
    .uf { width: 140px; }
    .sort { width: 190px; }
    .tb-main button.on { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-text); }
    .chips-row { gap: 10px; }
    .more { padding: 12px 0 0; border-top: 1px solid var(--border); }
    .saved { width: 200px; }
    .list-card { overflow: hidden; }
    .list-head { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .list { transition: opacity .15s; }
    .list.dim { opacity: .55; }
    .item {
      display: grid; grid-template-columns: 28px minmax(0, 1fr) 190px; gap: 12px; align-items: start;
      padding: 16px 20px 16px 12px; border-bottom: 1px solid var(--border); transition: background .1s;
    }
    .item:last-child { border-bottom: 0; }
    .item:hover { background: var(--surface-2); }
    .item.skel { display: block; padding: 18px 20px; }
    .main { color: inherit; text-decoration: none; display: grid; gap: 6px; min-width: 0; }
    .main:hover { text-decoration: none; }
    .main:hover .obj { text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
    .obj { font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.45; letter-spacing: -.006em; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; color: var(--muted); font-size: 12.5px; min-width: 0; }
    .meta .org { max-width: 360px; color: var(--text-2); }
    .meta .sep { color: var(--faint); }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 2px; }
    .star { width: 28px; height: 28px; padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--faint); }
    .star:hover:not(:disabled) { background: var(--hover); color: var(--text-2); }
    .star.on { color: #d97706; }
    .star.on ::ng-deep svg { fill: #f59e0b; stroke: #d97706; }
    .side-info { display: grid; gap: 2px; justify-items: end; text-align: right; }
    .dl-date { font-size: 13px; font-weight: 500; color: var(--text); }
    .dl-rel { font-size: 12px; }
    .dl-rel.t-bad { color: var(--bad); font-weight: 500; } .dl-rel.t-warn { color: var(--warn); font-weight: 500; } .dl-rel.t-ok { color: var(--ok); } .dl-rel.t-neutral { color: var(--muted); }
    .value { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
    .check-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); margin-left: 12px; }
    .pager { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--border); }
  `,
})
export class OpportunitiesPage implements OnInit, OnDestroy {
  protected readonly api = inject(Api);
  protected readonly ufs = UFS;
  protected readonly estados = ['Recebendo propostas', 'Abertura futura', 'Prazo encerrado', 'Sem prazo confirmado', 'Suspensa'];
  protected readonly modalidades = Object.entries(MODALIDADES).map(([k, v]) => [Number(k), v] as [number, string]);
  protected readonly relevancias = Object.entries(LABEL_TEXT).filter(([k]) => k !== 'fora');
  protected readonly aderencias = Object.entries(AGIL_CHIP).filter(([k]) => k !== 'fora');
  protected readonly agilText = AGIL_TEXT; protected readonly agilTone = agilTone;
  protected readonly labelText = LABEL_TEXT;
  protected readonly watchText = WATCH_TEXT;
  protected readonly fmtDate = fmtDate; protected readonly fmtDay = fmtDay; protected readonly fmtMoney = fmtMoney;
  protected readonly fmtRelative = fmtRelative; protected readonly fmtInt = fmtInt; protected readonly deadlineTone = deadlineTone; protected readonly stateTone = stateTone;

  text = ''; uf = ''; modalidade: number[] = []; relevancia: string[] = []; estado: string[] = []; aderencia: string[] = []; incluirFora = false;
  savedId: number | null = null; sort = 'agil';
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
      text: this.text, uf: this.uf ? [this.uf] : [], modalidade: this.modalidade, relevancia: this.relevancia,
      aderencia: q === 'agil' ? ['nucleo', 'plenario', 'compilacao'] : this.aderencia, incluirFora: this.incluirFora || undefined,
      estado: q === 'abertas' ? ['Recebendo propostas'] : q === 'agil' ? ['Recebendo propostas', 'Abertura futura'] : this.estado, prazoDias: q === 'encerram7' ? 7 : null,
      watch: q === 'acompanhadas' ? 'acompanhadas' : 'todas', sort: this.sort, dir: this.sort === 'prazo' || this.sort === 'orgao' ? 'asc' : 'desc',
      page: this.page(), pageSize: this.pageSize,
    };
  }
  protected hasFilters(): boolean { return !!(this.text || this.uf || this.modalidade.length || this.relevancia.length || this.estado.length || this.aderencia.length || this.incluirFora || this.quick() !== 'todas'); }
  protected setQuick(q: Quick): void { this.quick.set(this.quick() === q ? 'todas' : q); this.search(); }
  protected toggle<T>(arr: T[], v: T): void { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); this.search(); }
  protected debounced(): void { if (this.typing) clearTimeout(this.typing); this.typing = setTimeout(() => this.search(), 300); }
  protected search(): void { this.page.set(1); void this.load(); }
  protected clear(): void {
    this.text = ''; this.uf = ''; this.modalidade = []; this.relevancia = []; this.estado = []; this.aderencia = []; this.incluirFora = false; this.savedId = null; this.quick.set('todas');
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
    this.estado = f.estado ?? []; this.aderencia = f.aderencia ?? []; this.incluirFora = !!f.incluirFora; this.quick.set('todas'); this.search();
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
