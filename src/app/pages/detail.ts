import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AGIL_TEXT, Api, LABEL_TEXT, Row, SITUACAO_TEXT, WATCH_TEXT, agilTone, deadlineTone, fmtDate, fmtDay, fmtMoney, fmtRelative, stateTone } from '../api';
import { Icon } from '../icon';

export const CHECKLIST = [
  'Atestados de capacidade técnica', 'Prova de conceito / demonstração', 'Habilitação (jurídica, fiscal, técnica)', 'Migração de dados',
  'Integrações (Executivo, contabilidade, diário)', 'Treinamento', 'Suporte e SLA', 'Hospedagem e segurança', 'Acessibilidade', 'Módulos exigidos conferidos',
];
const GROUP_TEXT: Record<string, string> = {
  central: 'Sinal central', funcao: 'Função legislativa', tecnologia: 'Software', adjacente: 'Solução adjacente', auxiliar: 'Contexto', negativo: 'Fora do escopo',
};

@Component({
  selector: 'app-detail',
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <a class="back" routerLink="/oportunidades"><app-icon name="chevronLeft" [size]="15" /> Oportunidades</a>
    @if (error()) { <div class="banner bad"><app-icon name="alert" /> {{ error() }}</div> }
    @if (d(); as o) {
      <header class="hero card fade-in">
        <div class="row tags">
          @if (o['agil']; as g) { <span class="badge" [class]="'badge ' + agilTone(g['aderencia'])">{{ agilText[g['aderencia']] }}{{ g['aderencia'] !== 'fora' ? ' · ' + g['score'] + '/100' : '' }}</span> }
          <span class="badge" [class]="'badge b-' + o['relevance']">{{ labelText[o['relevance']] }}</span>
          <span class="badge" [class]="'badge ' + stateTone(o['derived_state'])">{{ o['derived_state'] }}</span>
          @if (o['datas_a_conferir']) { <span class="badge b-warn">Datas a conferir: publicação posterior ao encerramento</span> }
          @if (o['not_found_at']) { <span class="badge b-warn">Detalhe 404 · situação mantida</span> }
          <span class="mono muted right">{{ o['control_id'] }}</span>
        </div>
        <h1>{{ o['orgao_nome'] }}</h1>
        <div class="meta">
          <span><app-icon name="pin" [size]="14" /> {{ o['municipio'] }}/{{ o['uf'] }}</span>
          <span><app-icon name="gavel" [size]="14" /> {{ o['modalidade_nome'] }}</span>
          <span><app-icon name="file" [size]="14" /> Processo {{ o['detail']['processo'] || '—' }} · compra {{ o['detail']['numero_compra'] || '—' }}</span>
        </div>
        <div class="row actions">
          <button class="primary" (click)="open('pncp')"><app-icon name="external" [size]="15" /> Abrir no PNCP</button>
          @if (o['link_origem']) { <button (click)="open('origem')"><app-icon name="external" [size]="15" /> Portal de disputa</button> }
          @if (o['detail']['link_processo']) { <button (click)="open('processo')"><app-icon name="external" [size]="15" /> Processo eletrônico</button> }
        </div>
      </header>
      @if (msg()) { <div class="banner info"><app-icon name="info" /> {{ msg() }}</div> }

      <div class="layout">
        <div class="stack">
          <section class="card pad" aria-labelledby="h-obj">
            <h2 id="h-obj">Objeto</h2>
            <p class="objeto">{{ o['detail']['objeto'] }}</p>
            @if (o['detail']['info_complementar']) { <p class="muted">{{ o['detail']['info_complementar'] }}</p> }
            <dl class="kv" style="margin-top:14px">
              <dt>Unidade</dt><dd>{{ o['unidade_nome'] || '—' }}</dd>
              <dt>Situação oficial</dt><dd>{{ o['situacao_nome'] }} <span class="muted">(código {{ o['detail']['situacao_id'] ?? '—' }})</span></dd>
              <dt>Fonte</dt><dd>PNCP · coletado {{ fmtDate(o['detail']['first_seen_at']) }} · atualizado na fonte {{ fmtDate(o['detail']['source_updated_utc']) }}</dd>
            </dl>
          </section>

          <section class="card pad" aria-labelledby="h-rel">
            <div class="row" style="margin-bottom:12px">
              <div class="grow"><h2 id="h-rel">Por que é relevante</h2>
                @if (o['classification']; as c) {
                  <p class="muted small">Regras {{ c['rules_version'] }} · pontuação {{ c['score'] }} · automático: {{ labelText[c['label_auto']] }}
                    @if (c['label_manual']) { · <strong>sua decisão: {{ labelText[c['label_manual']] }}</strong> }
                    @if (c['needs_enrichment']) { · aguardando itens/edital }</p>
                }
              </div>
            </div>
            @if (o['classification']; as c) {
              @if (c['evidences'].length === 0) { <p class="muted">Nenhuma evidência nas regras atuais.</p> }
              <div class="evidences">
                @for (e of c['evidences']; track $index) {
                  <div class="ev" [class]="'ev g-' + e.group">
                    <div class="row ev-head">
                      <strong>{{ e.label }}</strong>
                      <span class="badge plain b-neutral">{{ groupText[e.group] ?? e.group }}</span>
                      <span class="muted small right">{{ e.source }}{{ e.item ? ' · item ' + e.item : '' }}</span>
                    </div>
                    <q>{{ e.snippet }}</q>
                  </div>
                }
              </div>
            }
            <hr class="sep" />
            <div class="row">
              <span class="muted small">Sua decisão</span>
              <div class="segmented" role="group" aria-label="Decisão manual de relevância">
                <button [attr.aria-pressed]="manual() === 'alta'" (click)="label('alta')">Alta</button>
                <button [attr.aria-pressed]="manual() === 'revisar'" (click)="label('revisar')">Revisar</button>
                <button [attr.aria-pressed]="manual() === 'fora'" (click)="label('fora')">Descartar</button>
                <button [attr.aria-pressed]="!manual()" (click)="label(null)">Automático</button>
              </div>
            </div>
          </section>

          @if (o['agil']; as g) {
            <section class="card pad" aria-labelledby="h-agil">
              <h2 id="h-agil">Aderência ao Ágil</h2>
              <p class="muted small" style="margin:4px 0 12px">{{ g['resumo'] }}</p>
              @if (g['bloqueios'].length) {
                <div class="banner warn small" style="margin-bottom:10px">Fora do Ágil (parceria, revenda ou módulo de enquadramento): {{ g['bloqueios'].join(', ') }}</div>
              }
              @if (g['temas'].length === 0) { <p class="muted">Nenhum tema do catálogo do Ágil encontrado no objeto, itens ou editais lidos.</p> }
              <div class="temas">
                @for (t of g['temas']; track t.id) {
                  <div class="tema" [class]="'tema s-' + t.situacao">
                    <span class="grow">{{ t.label }}</span>
                    <span class="muted small">{{ t.entrega }}{{ t.noObjeto ? ' · no objeto' : ' · ' + t.mencoes + ' menções' }}</span>
                    <span class="badge plain" [class]="'badge plain ' + situacaoTone(t.situacao)">{{ situacaoText[t.situacao] }}</span>
                  </div>
                }
              </div>
              <p class="muted small" style="margin-top:10px">Situação conforme o relatório de requisitos do Ágil. A lista é um indicador: confira cada exigência no TR antes de ofertar.</p>
            </section>
          }
          @if (o['republicacoes_lista']?.length) {
            <section class="card pad">
              <h2>Outras publicações da mesma compra</h2>
              @for (x of o['republicacoes_lista']; track x['id']) {
                <p class="small"><a [routerLink]="['/oportunidade', x['id']]">{{ x['control_id'] }}</a> · publicada {{ fmtDay(x['data_publicacao']) }} · {{ x['derived_state'] }}</p>
              }
            </section>
          }

          <section class="card" aria-labelledby="h-it">
            <div class="card-head"><h2 id="h-it" class="grow">Itens <span class="muted">({{ o['items'].length }})</span></h2></div>
            <div class="table-wrap">
              @if (o['items'].length === 0) { <p class="muted">Itens ainda não coletados.</p> } @else {
                <table>
                  <thead><tr><th>#</th><th>Descrição</th><th class="r">Qtde</th><th>Unid.</th><th class="r">Total do item</th></tr></thead>
                  <tbody>
                    @for (i of o['items']; track i['numero_item']) {
                      <tr><td class="num">{{ i['numero_item'] }}</td><td>{{ i['descricao'] }}</td><td class="r num">{{ i['quantidade'] }}</td><td>{{ i['unidade_medida'] }}</td>
                        <td class="r num">{{ fmtMoney(i['valor_total_cents'], i['sigiloso']) }}</td></tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          </section>

          <section class="card" aria-labelledby="h-doc">
            <div class="card-head">
              <div class="grow">
                <h2 id="h-doc">Edital e documentos <span class="muted">({{ o['documents'].length }})</span></h2>
                <p>Visualize o PDF aqui mesmo ou baixe para montar sua documentação.</p>
              </div>
              <button class="sm" (click)="refreshDocs()" [disabled]="busy() === 'lista'"><app-icon name="refresh" [size]="13" [class.spin]="busy() === 'lista'" /> Atualizar lista</button>
              <button class="sm primary" (click)="saveAll()" [disabled]="!o['documents'].length || busy() === 'todos'"><app-icon name="download" [size]="13" /> {{ busy() === 'todos' ? 'Baixando…' : 'Baixar todos' }}</button>
            </div>
            <div class="card-body">
              <form class="search" style="margin-bottom:12px" (ngSubmit)="searchDocs()" role="search">
                <app-icon name="search" [size]="15" />
                <label class="sr-only" for="dq">Buscar nos documentos</label>
                <input id="dq" type="search" name="dq" [(ngModel)]="docQuery" placeholder="Buscar trecho no texto dos editais já lidos" />
              </form>
              @for (x of excerpts(); track $index) { <p class="excerpt"><strong>{{ x['titulo'] }} · p. {{ x['page'] }}</strong> <q>{{ x['snippet'] }}</q></p> }
              @if (o['documents'].length === 0) {
                <p class="muted">Nenhum documento listado ainda. Clique em “Atualizar lista” para consultar o PNCP.</p>
              }
              <div class="docs">
                @for (x of o['documents']; track x['id']) {
                  <div class="doc">
                    <span class="doc-icon"><app-icon name="file" [size]="16" [stroke]="1.75" /></span>
                    <div class="grow">
                      <div class="doc-title">{{ x['titulo'] }}</div>
                      <div class="muted small">{{ x['tipo_nome'] }} · publicado {{ fmtDay(x['data_publicacao']) }}{{ x['bytes'] ? ' · ' + fmtSize(x['bytes']) : '' }}
                        @if (x['text_status'] === 'imagem') { · escaneado (sem texto pesquisável) }
                        @if (x['error']) { · {{ x['error'] }} }</div>
                    </div>
                    <button class="sm" (click)="viewDoc(x['id'])" [disabled]="busy() === 'v' + x['id']">{{ busy() === 'v' + x['id'] ? 'Abrindo…' : 'Visualizar' }}</button>
                    <button class="sm" (click)="saveDoc(x['id'])" [disabled]="busy() === 's' + x['id']"><app-icon name="download" [size]="13" /> Baixar</button>
                    <button class="icon sm ghost" (click)="openDoc(x['id'])" title="Abrir no PNCP" aria-label="Abrir no PNCP"><app-icon name="external" [size]="14" /></button>
                  </div>
                }
              </div>
            </div>
          </section>

          <section class="card pad" aria-labelledby="h-hist">
            <h2 id="h-hist" style="margin-bottom:12px">Histórico</h2>
            @if (o['events'].length === 0) { <p class="muted">Sem mudanças registradas.</p> }
            <ol class="timeline">
              @for (e of o['events']; track e['id']) {
                <li>
                  <span class="t-dot"></span>
                  <div><strong>{{ e['text'] }}</strong> <span class="muted small">{{ fmtDate(e['created_at']) }}{{ e['silent'] ? ' · importação inicial' : '' }}</span>
                    @if (changed(e, 'encerramento')) { <div class="small">Encerramento: {{ fmtDate(e['payload'].before.encerramento) }} → <strong>{{ fmtDate(e['payload'].after.encerramento) }}</strong></div> }
                    @if (changed(e, 'situacao')) { <div class="small">Situação: {{ e['payload'].before.situacao }} → <strong>{{ e['payload'].after.situacao }}</strong></div> }
                  </div>
                </li>
              }
            </ol>
            @for (v of o['divergences']; track v['id']) {
              <div class="banner warn small" style="margin-top:8px">{{ v['field'] }}: {{ v['source_a'] }} = {{ v['value_a'] }} · {{ v['source_b'] }} = {{ v['value_b'] }}</div>
            }
          </section>
        </div>

        <aside class="stack aside">
          <section class="card deadline-card" [class]="'card deadline-card t-' + deadlineTone(o['encerramento_utc'], o['derived_state'])">
            <span class="muted small">Encerramento de propostas</span>
            <div class="big num">{{ fmtDate(o['encerramento_utc']) }}</div>
            @if (o['derived_state'] === 'Recebendo propostas') { <div class="rel">{{ fmtRelative(o['encerramento_utc']) }}</div> }
            <p class="muted small">{{ origin(o) }}</p>
            <hr class="sep" />
            <dl class="kv small2">
              <dt>Abertura</dt><dd class="num">{{ fmtDate(o['abertura_utc']) }}</dd>
              <dt>Publicação</dt><dd class="num">{{ fmtDate(o['data_publicacao']) }}</dd>
              <dt>Valor estimado</dt><dd class="num strong">{{ fmtMoney(o['valor_estimado_cents'], o['orcamento_sigiloso']) }}</dd>
              <dt>Homologado</dt><dd class="num">{{ fmtMoney(o['valor_homologado_cents']) }}</dd>
            </dl>
            <p class="muted small" style="margin-top:10px">Sessão, impugnação e esclarecimentos têm prazos próprios: confira no edital.</p>
          </section>

          <section class="card pad" aria-labelledby="h-w">
            <div class="row" style="margin-bottom:12px">
              <h2 id="h-w" class="grow">Acompanhamento</h2>
              <button class="icon sm ghost star" [class.on]="wFav" (click)="wFav = !wFav" [attr.aria-pressed]="wFav" aria-label="Favorita" title="Favorita"><app-icon name="star" [size]="16" /></button>
            </div>
            <div class="segmented full" role="group" aria-label="Estado de triagem">
              <button [attr.aria-pressed]="wStatus === ''" (click)="wStatus = ''">Não</button>
              @for (w of watchOptions; track w[0]) { <button [attr.aria-pressed]="wStatus === w[0]" (click)="wStatus = w[0]">{{ w[1] }}</button> }
            </div>
            <label class="field" style="margin-top:14px" for="notes">Notas
              <textarea id="notes" rows="4" [(ngModel)]="wNotes" placeholder="Contatos, dúvidas do edital, decisão comercial…"></textarea>
            </label>
            <div class="check-head">
              <span class="small strong">Checklist de pré-venda</span>
              <span class="muted small">{{ checkDone() }}/{{ checklist.length }}</span>
            </div>
            <div class="progress"><span [style.width.%]="(checkDone() / checklist.length) * 100"></span></div>
            <div class="checks">
              @for (c of checklist; track c) {
                <label class="check"><input type="checkbox" [checked]="!!wCheck[c]" (change)="toggleCheck(c)" /> <span>{{ c }}</span></label>
              }
            </div>
            <button class="primary" style="width:100%;margin-top:12px" (click)="saveWatch()"><app-icon name="check" [size]="15" /> Salvar acompanhamento</button>
            <p class="muted small" style="margin-top:8px">Acompanhadas recebem lembretes 72 h, 24 h e 3 h antes do prazo.</p>
          </section>
        </aside>
      </div>
    } @else if (!error()) {
      <div class="card pad"><div class="skeleton" style="height:20px;width:50%"></div><div class="skeleton" style="height:14px;width:30%;margin-top:12px"></div></div>
    }
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; font-weight: 500; margin-bottom: 12px; }
    .back:hover { color: var(--text); text-decoration: none; }
    .hero { padding: 20px 22px; display: grid; gap: 10px; margin-bottom: 16px;  }
    .hero h1 { font-size: 22px; }
    .tags { gap: 6px; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--muted); font-size: 13px; }
    .meta span { display: inline-flex; align-items: center; gap: 6px; }
    .actions { margin-top: 4px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
    .aside { position: sticky; top: 0; }
    .objeto { font-size: 14.5px; line-height: 1.6; margin: 10px 0 6px; }
    .evidences { display: grid; gap: 8px; }
    .ev { border: 1px solid var(--border); border-left: 3px solid var(--neutral); border-radius: 10px; padding: 10px 12px; background: var(--surface-2); display: grid; gap: 6px; }
    .ev.g-central { border-left-color: var(--ok); } .ev.g-funcao { border-left-color: var(--accent); } .ev.g-tecnologia, .ev.g-adjacente { border-left-color: var(--info); } .ev.g-negativo { border-left-color: var(--bad); }
    .ev-head { gap: 8px; }
    q { quotes: none; color: var(--text-2); font-size: 13px; line-height: 1.5; } q::before { content: '“'; } q::after { content: '”'; }
    .excerpt { font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--warn-soft); margin-bottom: 8px; }
    .temas { display: grid; gap: 6px; }
    .tema { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid var(--border); border-left: 3px solid var(--neutral); border-radius: 8px; font-size: 13px; }
    .tema.s-pronto { border-left-color: var(--ok); } .tema.s-parcial { border-left-color: var(--info); } .tema.s-falta { border-left-color: var(--warn); } .tema.s-fora { border-left-color: var(--bad); }
    .docs { display: grid; gap: 8px; }
    .doc { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
    .doc-icon { width: 32px; height: 32px; border-radius: 7px; display: grid; place-items: center; border: 1px solid var(--border); color: var(--muted); flex: none; }
    :host ::ng-deep .spin svg { animation: rot 1s linear infinite; } @keyframes rot { to { transform: rotate(360deg); } }
    .doc-title { font-weight: 600; font-size: 13px; }
    .timeline { list-style: none; margin: 0; padding: 0 0 0 4px; display: grid; gap: 14px; position: relative; }
    .timeline::before { content: ''; position: absolute; left: 8px; top: 6px; bottom: 6px; width: 2px; background: var(--border); }
    .timeline li { display: grid; grid-template-columns: 18px 1fr; gap: 10px; position: relative; font-size: 13px; }
    .t-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin: 4px 0 0; box-shadow: 0 0 0 3px var(--surface); position: relative; left: 4px; }
    .deadline-card { padding: 18px 20px; }
    .deadline-card .big { font-family: var(--font-display); font-size: 24px; font-weight: 600; margin-top: 6px; }
    .deadline-card .rel { font-weight: 600; margin-top: 2px; }
    .t-bad .rel { color: var(--bad); } .t-warn .rel { color: var(--warn); } .t-ok .rel { color: var(--ok); }
    .deadline-card.t-bad { border-color: color-mix(in srgb, var(--bad) 40%, var(--border)); }
    .small2 { grid-template-columns: 110px 1fr; font-size: 12.5px; }
    .strong { font-weight: 600; }
    .segmented.full { display: flex; } .segmented.full button { flex: 1; padding: 0 6px; }
    .star.on { color: #f5b301; } .star.on ::ng-deep svg { fill: #f5b301; }
    .check-head { display: flex; justify-content: space-between; margin: 14px 0 6px; }
    .progress { height: 6px; background: var(--surface-3); border-radius: 6px; overflow: hidden; }
    .progress span { display: block; height: 100%; background: var(--ok); border-radius: 6px; transition: width .3s var(--ease); }
    .checks { display: grid; gap: 2px; margin-top: 8px; }
    .check { display: flex; gap: 9px; align-items: center; font-size: 13px; padding: 5px 4px; border-radius: 7px; cursor: pointer; }
    .check:hover { background: var(--surface-2); }
    .check input { width: 16px; height: 16px; accent-color: var(--accent); margin: 0; }
  `,
})
export class DetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  protected readonly api = inject(Api);
  protected readonly labelText = LABEL_TEXT;
  protected readonly agilText = AGIL_TEXT; protected readonly agilTone = agilTone; protected readonly situacaoText = SITUACAO_TEXT;
  protected situacaoTone(s: string): string { return s === 'pronto' ? 'b-ok' : s === 'parcial' ? 'b-info' : s === 'falta' ? 'b-warn' : 'b-bad'; }
  protected readonly groupText = GROUP_TEXT;
  protected readonly checklist = CHECKLIST;
  protected readonly watchOptions = Object.entries(WATCH_TEXT);
  protected readonly fmtDate = fmtDate; protected readonly fmtDay = fmtDay; protected readonly fmtMoney = fmtMoney; protected readonly fmtRelative = fmtRelative;
  protected readonly deadlineTone = deadlineTone; protected readonly stateTone = stateTone;

  protected readonly d = signal<Row | null>(null);
  protected readonly error = signal('');
  protected readonly msg = signal('');
  protected readonly excerpts = signal<Row[]>([]);
  protected readonly manual = computed(() => this.d()?.['classification']?.['label_manual'] ?? null);
  wStatus = ''; wFav = false; wNotes = ''; wCheck: Record<string, boolean> = {}; docQuery = '';
  private id = 0;
  private sub: { unsubscribe(): void } | null = null;

  ngOnInit(): void { this.sub = this.route.paramMap.subscribe((p) => { this.id = Number(p.get('id')); void this.load(); }); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  protected readonly busy = signal<string | null>(null);
  protected fmtSize(b: number): string { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  private async run(key: string, fn: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try { await fn(); } catch (e) { this.msg.set('Não foi possível: ' + ((e as Error).message ?? '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    this.busy.set(null);
  }
  protected viewDoc(id: number): Promise<void> {
    return this.run('v' + id, async () => { const r = await this.api.raw.docs.view(id); this.msg.set(r.ok ? '' : r.reason); await this.load(); });
  }
  protected saveDoc(id: number): Promise<void> {
    return this.run('s' + id, async () => { const r = await this.api.raw.docs.save(id); if (r.ok) this.msg.set('Arquivo salvo em ' + r.path); await this.load(); });
  }
  protected saveAll(): Promise<void> {
    return this.run('todos', async () => {
      const r = await this.api.raw.docs.saveAll(this.id);
      if (r.path) this.msg.set(`${r.saved} documento(s) salvo(s) em ${r.path}` + (r.failed?.length ? ` · ${r.failed.length} falharam` : ''));
      else if (r.reason) this.msg.set(r.reason);
      await this.load();
    });
  }
  protected refreshDocs(): Promise<void> {
    return this.run('lista', async () => { const n = await this.api.raw.docs.refresh(this.id); this.msg.set(`${n} documento(s) encontrados no PNCP.`); await this.load(); });
  }
  protected checkDone(): number { return this.checklist.filter((c) => this.wCheck[c]).length; }
  protected async load(): Promise<void> {
    if (!this.api.available) return;
    try {
      const o = await this.api.raw.opps.get(this.id);
      if (!o) { this.error.set('Oportunidade não encontrada no acervo local.'); return; }
      this.d.set(o);
      this.wStatus = o.watch?.status ?? ''; this.wFav = !!o.watch?.favorito; this.wNotes = o.watch?.notes ?? ''; this.wCheck = { ...(o.watch?.checklist ?? {}) };
    } catch (e) { this.error.set((e as Error).message); }
  }
  protected changed(e: Row, key: string): boolean { const b = e['payload']?.before; return !!b && typeof b === 'object' && key in b; }
  protected origin(o: Row): string {
    const origin = o['prazo_origem'];
    return origin === 'pncp-brasilia' ? 'Horário de Brasília (regra do PNCP para datas sem fuso).' : origin === 'offset-explicito' ? 'Fuso informado pela fonte.' : 'Horário a confirmar no edital.';
  }
  protected docClass(x: Row): string { return x['status'] === 'baixado' ? (x['text_status'] === 'ok' ? 'b-ok' : 'b-warn') : x['status'] === 'erro' ? 'b-bad' : 'b-neutral'; }
  protected docText(x: Row): string {
    return x['status'] === 'baixado' ? (x['text_status'] === 'ok' ? 'Texto lido' : x['text_status'] === 'imagem' ? 'Só imagem' : 'Parcial')
      : x['status'] === 'erro' ? 'Erro' : x['status'] === 'ignorado' ? 'Não suportado' : 'Aguardando';
  }
  protected async open(kind: string): Promise<void> { const r = await this.api.raw.open({ kind, id: this.id }); this.msg.set(r.ok ? '' : r.reason); }
  protected async openDoc(id: number): Promise<void> { const r = await this.api.raw.open({ kind: 'doc', id }); this.msg.set(r.ok ? '' : r.reason); }
  protected async label(l: string | null): Promise<void> {
    await this.api.raw.opps.label({ id: this.id, label: l }); await this.load(); void this.api.refreshStats();
    this.msg.set(l ? 'Decisão registrada; ela é preservada ao reprocessar as regras.' : 'Voltou à classificação automática.');
  }
  protected toggleCheck(c: string): void { this.wCheck = { ...this.wCheck, [c]: !this.wCheck[c] }; }
  protected async saveWatch(): Promise<void> {
    if (!this.wStatus) await this.api.raw.watch.set({ id: this.id, patch: null });
    else await this.api.raw.watch.set({ id: this.id, patch: { status: this.wStatus, favorito: this.wFav, notes: this.wNotes, checklist: this.wCheck } });
    await this.load(); void this.api.refreshStats();
    this.msg.set(this.wStatus ? 'Acompanhamento salvo.' : 'Oportunidade deixou de ser acompanhada.');
  }
  protected async searchDocs(): Promise<void> { this.excerpts.set(this.docQuery.trim() ? await this.api.raw.opps.excerpts({ id: this.id, q: this.docQuery }) : []); }
}
