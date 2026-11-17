import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, MODALIDADES, Row, fmtDate, fmtRelative } from '../api';
import { Icon } from '../icon';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <span class="eyebrow">Preferências</span>
        <h1>Configurações</h1>
        <p>Coleta, limites, alertas, comportamento no Windows, regras de relevância e atualizações.</p>
      </div>
      <div class="actions">
        @if (msg()) { <span class="saved-msg fade-in"><app-icon name="check" [size]="15" /> {{ msg() }}</span> }
        <button class="primary" (click)="save()" [disabled]="!s()"><app-icon name="check" [size]="15" /> Salvar alterações</button>
      </div>
    </header>

    <div class="layout">
      <nav class="toc" aria-label="Seções">
        @for (t of toc; track t[0]) { <a [href]="'#' + t[0]" (click)="go($event, t[0])">{{ t[1] }}</a> }
      </nav>

      <div class="stack">
        <section class="card" id="atualizacoes">
          <div class="card-head"><div class="grow"><h2>Atualizações</h2><p>Novas versões são baixadas em segundo plano; instale com um clique.</p></div></div>
          <div class="card-body upd">
            <div class="u-badge"><app-icon name="sparkles" [size]="20" /></div>
            <div class="grow">
              <strong>Versão instalada {{ upd()?.['currentVersion'] ?? '—' }}</strong>
              <p class="muted small">{{ updText() }}</p>
              @if (upd()?.['status'] === 'baixando') { <div class="bar"><span [style.width.%]="upd()?.['percent'] ?? 0"></span></div> }
              @if (upd()?.['notes']) { <pre class="notes">{{ upd()?.['notes'] }}</pre> }
            </div>
            @if (['baixando', 'pronto'].includes(upd()?.['status'])) {
              <button class="primary" (click)="install()"><app-icon name="upload" [size]="15" /> Atualizar para {{ upd()?.['version'] }}</button>
            } @else {
              <button (click)="check()" [disabled]="upd()?.['status'] === 'verificando' || upd()?.['status'] === 'desativado'"><app-icon name="refresh" [size]="15" /> Verificar agora</button>
            }
          </div>
        </section>

        @if (s()) {
          <section class="card" id="coleta">
            <div class="card-head"><div><h2>Coleta</h2><p>Frequência, alcance e modalidades consultadas no PNCP.</p></div></div>
            <div class="card-body grid-fields">
              <label class="field">Intervalo da coleta (horas)<input type="number" min="0.25" step="0.25" [(ngModel)]="form.intervaloHoras" /></label>
              <label class="field">Horizonte de propostas abertas (dias)<input type="number" min="1" max="365" [(ngModel)]="form.horizonteDias" /></label>
              <label class="field">Dias da carga inicial<input type="number" min="1" max="60" [(ngModel)]="form.diasIniciais" /></label>
              <label class="field">Dias da busca histórica<input type="number" min="1" max="1095" [(ngModel)]="form.historicoDias" /></label>
              <label class="field">Sobreposição de janelas (dias)<input type="number" min="0" max="10" [(ngModel)]="form.sobreposicaoDias" /></label>
              <label class="field">Tempo máximo por execução (min)<input type="number" min="1" [(ngModel)]="form.orcamentoMinutos" /></label>
              <label class="field wide">UFs da coleta <small>vazio = nacional; separe por vírgula</small><input type="text" [(ngModel)]="ufText" placeholder="ex.: ES, MG, RJ" /></label>
            </div>
            <div class="card-body" style="padding-top:0">
              <h3 style="margin-bottom:8px">Modalidades</h3>
              <div class="chips">
                @for (m of mods; track m[0]) {
                  <button class="chip" [attr.aria-pressed]="form.modalidades.includes(m[0])" (click)="toggleMod(m[0])">{{ m[1] }}</button>
                }
                <button class="chip" [attr.aria-pressed]="!!form.incluirInexigibilidade" (click)="form.incluirInexigibilidade = !form.incluirInexigibilidade">Inexigibilidade (radar)</button>
              </div>
            </div>
          </section>

          <section class="card" id="alertas">
            <div class="card-head"><div><h2>Alertas e Windows</h2><p>Notificações, inicialização e comportamento da janela.</p></div></div>
            <div class="card-body toggles">
              <label class="switch"><input type="checkbox" [(ngModel)]="form.notificacoes" /> Notificações do Windows</label>
              <label class="switch"><input type="checkbox" [(ngModel)]="form.iniciarComWindows" /> Iniciar com o Windows (minimizado na bandeja)</label>
              <label class="switch"><input type="checkbox" [(ngModel)]="form.fecharParaBandeja" /> Fechar para a bandeja (encerre pelo menu da bandeja)</label>
              <label class="switch"><input type="checkbox" [(ngModel)]="form.guardarForaDoPerfil" /> Guardar também contratações fora do nicho (auditoria das regras)</label>
            </div>
            <div class="card-body grid-fields" style="padding-top:0">
              <label class="field">Lembretes antes do prazo <small>horas, separadas por vírgula</small><input type="text" [(ngModel)]="lembretesText" /></label>
              <label class="field">CNPJs de órgãos legislativos <small>um por linha</small><textarea rows="3" [(ngModel)]="cnpjText"></textarea></label>
            </div>
          </section>

          <section class="card" id="limites">
            <div class="card-head"><div><h2>Limites</h2><p>Proteções de rede e de leitura de anexos.</p></div></div>
            <div class="card-body grid-fields">
              <label class="field">Requisições simultâneas<input type="number" min="1" max="4" [(ngModel)]="form.concorrencia" /></label>
              <label class="field">Requisições por minuto<input type="number" min="10" [(ngModel)]="form.maxRequisicoesPorMinuto" /></label>
              <label class="field">Páginas por janela antes de dividir por UF<input type="number" min="10" [(ngModel)]="form.maxPaginasJanela" /></label>
              <label class="field">Tamanho máximo de anexo (bytes)<input type="number" [(ngModel)]="form.maxDocBytes" /></label>
              <label class="field">Páginas lidas por PDF<input type="number" [(ngModel)]="form.maxDocPaginas" /></label>
              <label class="field">Anexos por execução<input type="number" [(ngModel)]="form.maxDocsPorExecucao" /></label>
              <label class="field">Retenção de registros (dias)<input type="number" [(ngModel)]="form.retencaoLogDias" /></label>
              <label class="field">Retenção de anexos (dias)<input type="number" [(ngModel)]="form.retencaoAnexosDias" /></label>
            </div>
          </section>
        }

        <section class="card" id="regras">
          <div class="card-head"><div class="grow"><h2>Regras de relevância</h2><p>JSON versionado. Padrões são expressões regulares sobre o texto sem acentos. Salvar reclassifica o acervo (decisões manuais preservadas).</p></div></div>
          <div class="card-body">
            <label class="sr-only" for="rules">Regras</label>
            <textarea id="rules" rows="16" [(ngModel)]="rulesText" class="code"></textarea>
            <div class="row" style="margin-top:10px">
              <button class="primary" (click)="saveRules()">Salvar regras e reclassificar</button>
              <button (click)="resetRules()">Restaurar padrão</button>
              @if (rulesMsg()) { <span [class]="rulesErr() ? 'badge b-bad' : 'muted small'">{{ rulesMsg() }}</span> }
            </div>
          </div>
        </section>

        @if (info(); as i) {
          <section class="card" id="sobre">
            <div class="card-head"><div><h2>Sobre este computador</h2></div></div>
            <div class="card-body">
              <dl class="kv">
                <dt>Versão</dt><dd>{{ i['version'] }} · Electron {{ i['electron'] }}</dd>
                <dt>Dados</dt><dd class="mono">{{ i['dataDir'] }}</dd>
                <dt>Banco</dt><dd>SQLite {{ i['sqlite'].sqlite }} · busca FTS5 {{ i['sqlite'].fts5 ? 'ativa' : 'INDISPONÍVEL' }} · integridade {{ i['sqlite'].integrity }}</dd>
                @if (i['recovered']) { <dt>Recuperação</dt><dd>Banco corrompido preservado em {{ i['recovered'] }}.</dd> }
              </dl>
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 22px; align-items: start; }
    .toc { position: sticky; top: 0; display: grid; gap: 2px; }
    .toc a { padding: 7px 10px; border-radius: 8px; color: var(--text-2); font-size: 13px; font-weight: 560; }
    .toc a:hover { background: var(--surface-3); text-decoration: none; }
    .grid-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px 16px; }
    .wide { grid-column: span 2; }
    .toggles { display: grid; gap: 14px; }
    .code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; line-height: 1.5; }
    .upd { display: flex; gap: 14px; align-items: flex-start; }
    .u-badge { width: 44px; height: 44px; border-radius: 12px; background: var(--brand-grad); color: #fff; display: grid; place-items: center; flex: none; }
    .bar { height: 6px; border-radius: 6px; background: var(--surface-3); overflow: hidden; margin-top: 8px; max-width: 360px; }
    .bar span { display: block; height: 100%; background: var(--brand-grad); }
    .notes { margin-top: 8px; padding: 10px; background: var(--surface-2); border-radius: 8px; font-size: 12.5px; max-height: 140px; overflow: auto; }
    .saved-msg { display: inline-flex; align-items: center; gap: 6px; color: var(--ok); font-weight: 600; font-size: 13px; }
  `,
})
export class SettingsPage implements OnInit {
  protected readonly api = inject(Api);
  protected readonly mods = Object.entries(MODALIDADES).filter(([k]) => Number(k) !== 9).map(([k, v]) => [Number(k), v] as [number, string]);
  protected readonly toc: [string, string][] = [['atualizacoes', 'Atualizações'], ['coleta', 'Coleta'], ['alertas', 'Alertas e Windows'], ['limites', 'Limites'], ['regras', 'Regras'], ['sobre', 'Sobre']];
  protected readonly s = signal<Row | null>(null);
  protected readonly msg = signal('');
  protected readonly info = signal<Row | null>(null);
  protected readonly rulesMsg = signal('');
  protected readonly rulesErr = signal(false);
  protected readonly upd = computed(() => this.api.update());
  protected readonly updText = computed(() => {
    const u = this.upd();
    switch (u?.['status']) {
      case 'desativado': return 'Atualizações automáticas funcionam no aplicativo instalado.';
      case 'verificando': return 'Verificando…';
      case 'atualizado': return `Você está na versão mais recente${u['checkedAt'] ? ' (verificado ' + fmtRelative(u['checkedAt']) + ')' : ''}.`;
      case 'baixando': return `Baixando a versão ${u['version']}… ${u['percent'] ?? 0}%`;
      case 'pronto': return `Versão ${u['version']} pronta. Clique para instalar e reiniciar.`;
      case 'instalando': return 'Instalando e reiniciando…';
      case 'erro': return u['error'] ?? 'Não foi possível verificar.';
      default: return 'A verificação automática roda ao abrir o app e a cada 4 horas.';
    }
  });
  form: any = { modalidades: [] };
  ufText = ''; lembretesText = ''; cnpjText = ''; rulesText = '';
  protected readonly fmtDate = fmtDate;

  async ngOnInit(): Promise<void> {
    if (!this.api.available) return;
    this.apply(await this.api.raw.settings.get());
    this.rulesText = JSON.stringify(await this.api.raw.rules.get(), null, 2);
    this.info.set(await this.api.raw.info());
  }
  private apply(s: Row): void {
    this.form = { ...s, modalidades: [...s['modalidades']] };
    this.ufText = (s['ufColeta'] as string[]).join(', ');
    this.lembretesText = (s['lembretesHoras'] as number[]).join(', ');
    this.cnpjText = (s['cnpjsLegislativos'] as string[]).join('\n');
    this.s.set(s);
  }
  protected go(e: Event, id: string): void { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  protected toggleMod(m: number): void {
    const set = new Set<number>(this.form.modalidades);
    if (set.has(m)) set.delete(m); else set.add(m);
    this.form.modalidades = [...set];
  }
  protected async save(): Promise<void> {
    const next = await this.api.raw.settings.set({
      ...this.form,
      ufColeta: this.ufText.split(/[,\s]+/).filter(Boolean),
      lembretesHoras: this.lembretesText.split(/[,\s]+/).filter(Boolean).map(Number),
      cnpjsLegislativos: this.cnpjText.split(/[,\n;\s]+/).filter(Boolean),
    });
    this.apply(next);
    this.msg.set('Salvo');
    setTimeout(() => this.msg.set(''), 2500);
  }
  protected async check(): Promise<void> { this.api.update.set(await this.api.raw.update.check()); }
  protected async install(): Promise<void> { this.api.update.set(await this.api.raw.update.install()); }
  protected async saveRules(): Promise<void> {
    try {
      const n = await this.api.raw.rules.set(JSON.parse(this.rulesText));
      this.rulesErr.set(false); this.rulesMsg.set(`Regras ${n.version} salvas; acervo reclassificado.`);
    } catch (e) { this.rulesErr.set(true); this.rulesMsg.set((e as Error).message); }
  }
  protected async resetRules(): Promise<void> {
    this.rulesText = JSON.stringify(await this.api.raw.rules.reset(), null, 2);
    this.rulesErr.set(false); this.rulesMsg.set('Regras padrão restauradas.');
  }
}
