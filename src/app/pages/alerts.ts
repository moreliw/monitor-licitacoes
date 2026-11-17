import { Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, Row, fmtDate, fmtRelative } from '../api';
import { Icon } from '../icon';

const KIND: Record<string, { icon: string; tone: string }> = {
  nova_publicacao: { icon: 'sparkles', tone: 'ok' }, lembrete: { icon: 'clock', tone: 'warn' }, prorrogacao: { icon: 'clock', tone: 'info' },
  retificacao: { icon: 'file', tone: 'info' }, suspensao: { icon: 'alert', tone: 'bad' }, revogacao: { icon: 'alert', tone: 'bad' },
  anulacao: { icon: 'alert', tone: 'bad' }, reabertura: { icon: 'refresh', tone: 'ok' }, documento_alterado: { icon: 'file', tone: 'info' },
  resumo: { icon: 'inbox', tone: 'primary' },
};

@Component({
  selector: 'app-alerts',
  imports: [RouterLink, Icon],
  template: `
    <header class="page-head">
      <div class="titles">
        <span class="eyebrow">Central de alertas</span>
        <h1>Alertas</h1>
        <p>Novas publicações do nicho, mudanças de prazo ou situação e lembretes. Ficam salvos mesmo se o Windows bloquear as notificações.</p>
      </div>
      <div class="actions">
        <button (click)="test()"><app-icon name="bell" [size]="15" /> Testar notificação</button>
        <button (click)="readAll()"><app-icon name="check" [size]="15" /> Marcar todos como lidos</button>
      </div>
    </header>
    @if (testMsg()) { <div class="banner" [class]="testOk() ? 'banner ok' : 'banner warn'" style="margin-bottom:14px"><app-icon name="info" /> {{ testMsg() }}</div> }

    @if (rows().length === 0) {
      <div class="card empty">
        <div class="e-icon"><app-icon name="bell" [size]="26" /></div>
        <h2>Nenhum alerta ainda</h2>
        <p>Você será avisado quando surgir uma licitação do nicho ou quando um prazo acompanhado se aproximar.</p>
      </div>
    } @else {
      <div class="card">
        <ul class="feed">
          @for (a of rows(); track a['id']) {
            <li [class.unread]="a['status'] === 'disparada'" [class.scheduled]="a['status'] === 'agendada'">
              <span class="a-icon" [class]="'a-icon t-' + kind(a).tone"><app-icon [name]="kind(a).icon" [size]="16" /></span>
              <div class="grow">
                <div class="row" style="gap:8px">
                  <strong>{{ a['title'] }}</strong>
                  @if (a['status'] === 'disparada') { <span class="badge b-primary">Novo</span> }
                  @if (a['status'] === 'agendada') { <span class="badge plain b-neutral">Agendado</span> }
                  <span class="muted small right" [title]="fmtDate(a['fire_at'])">{{ a['status'] === 'agendada' ? 'para ' + fmtDate(a['fire_at']) : fmtRelative(a['fire_at']) }}</span>
                </div>
                <pre>{{ a['body'] }}</pre>
                <div class="row a-actions">
                  @if (a['procurement_id']) { <a [routerLink]="['/oportunidade', a['procurement_id']]" (click)="read(a)">Abrir oportunidade <app-icon name="arrowRight" [size]="12" /></a> }
                  @if (a['status'] === 'disparada') { <button class="link small" (click)="read(a)">Marcar como lido</button> }
                </div>
              </div>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    .feed { list-style: none; margin: 0; padding: 6px; }
    .feed li { display: flex; gap: 14px; padding: 14px; border-radius: 12px; position: relative; }
    .feed li + li { border-top: 1px solid var(--border); border-radius: 0; }
    .feed li.unread { background: linear-gradient(90deg, var(--primary-soft), transparent 70%); }
    .feed li.scheduled { opacity: .75; }
    .a-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none; }
    .t-ok { background: var(--ok-soft); color: var(--ok); } .t-warn { background: var(--warn-soft); color: var(--warn); }
    .t-bad { background: var(--bad-soft); color: var(--bad); } .t-info { background: var(--info-soft); color: var(--info); }
    .t-primary { background: var(--primary-soft); color: var(--primary); }
    pre { margin-top: 4px; font-size: 13px; }
    .a-actions { margin-top: 8px; font-size: 13px; font-weight: 560; }
    .a-actions a { display: inline-flex; align-items: center; gap: 4px; }
  `,
})
export class AlertsPage implements OnInit {
  protected readonly api = inject(Api);
  protected readonly fmtDate = fmtDate; protected readonly fmtRelative = fmtRelative;
  protected readonly rows = signal<Row[]>([]);
  protected readonly testMsg = signal('');
  protected readonly testOk = signal(true);
  constructor() { effect(() => { this.api.alertsVersion(); untracked(() => void this.load()); }); }
  ngOnInit(): void { void this.load(); }
  protected kind(a: Row): { icon: string; tone: string } { return KIND[a['kind']] ?? { icon: 'bell', tone: 'primary' }; }
  protected async load(): Promise<void> { if (this.api.available) this.rows.set(await this.api.raw.alerts.list()); }
  protected async read(a: Row): Promise<void> { await this.api.raw.alerts.read(a['id']); await this.load(); void this.api.refreshStats(); }
  protected async readAll(): Promise<void> { await this.api.raw.alerts.read('all'); await this.load(); void this.api.refreshStats(); }
  protected async test(): Promise<void> {
    const r = await this.api.raw.alerts.test();
    this.testOk.set(r.supported);
    this.testMsg.set(r.supported ? 'Notificação enviada ao Windows. Se não apareceu, verifique o modo Não incomodar.' : 'Notificações não suportadas neste sistema; use esta central.');
  }
}
