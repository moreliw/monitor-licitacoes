export type DerivedState =
  | 'Abertura futura'
  | 'Recebendo propostas'
  | 'Prazo encerrado'
  | 'Sem prazo confirmado'
  | 'Suspensa'
  | 'Revogada'
  | 'Anulada';

/** Domínio de situação da contratação no PNCP. Códigos desconhecidos são preservados em situacao_id/situacao_nome. */
export const SITUACAO_PNCP: Record<number, string> = {
  1: 'Divulgada no PNCP',
  2: 'Revogada',
  3: 'Anulada',
  4: 'Suspensa',
};

export interface StateInput {
  situacao_id: number | null;
  situacao_nome: string | null;
  modalidade_id: number | null;
  abertura_utc: string | null;
  encerramento_utc: string | null;
}

export function deriveState(p: StateInput, now: Date = new Date()): DerivedState {
  // Suspensa/revogada/anulada têm precedência sobre qualquer data.
  const nome = (p.situacao_nome ?? '').toLowerCase();
  if (p.situacao_id === 4 || nome.includes('suspens')) return 'Suspensa';
  if (p.situacao_id === 2 || nome.includes('revogad')) return 'Revogada';
  if (p.situacao_id === 3 || nome.includes('anulad')) return 'Anulada';
  const t = now.getTime();
  const ab = p.abertura_utc ? Date.parse(p.abertura_utc) : NaN;
  const enc = p.encerramento_utc ? Date.parse(p.encerramento_utc) : NaN;
  if (Number.isNaN(enc) && Number.isNaN(ab)) return 'Sem prazo confirmado';
  // Inexigibilidade (9) não recebe propostas: sem janela confirmada nunca gera estado de recebimento.
  if (p.modalidade_id === 9 && Number.isNaN(enc)) return 'Sem prazo confirmado';
  if (!Number.isNaN(ab) && t < ab) return 'Abertura futura';
  if (!Number.isNaN(enc)) return t < enc ? 'Recebendo propostas' : 'Prazo encerrado';
  return 'Sem prazo confirmado'; // só abertura passada, sem encerramento: não comprova recebimento
}

export const ACTIVE_STATES: DerivedState[] = ['Abertura futura', 'Recebendo propostas'];
