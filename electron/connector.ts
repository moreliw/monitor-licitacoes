/** Contrato de conectores de fonte. O PNCP é a implementação real do MVP; novas fontes plugam aqui. */

export interface ProcurementRef {
  cnpj: string;
  ano: number;
  sequencial: number;
}

export interface NormalizedProcurement extends ProcurementRef {
  controlId: string;
  source: string;
  numeroCompra: string | null;
  processo: string | null;
  orgaoNome: string | null;
  poder: string | null;
  esfera: string | null;
  unidadeNome: string | null;
  codigoUnidade: string | null;
  uf: string | null;
  municipio: string | null;
  codigoIbge: string | null;
  orgaoSubrogado: string | null;
  unidadeSubrogada: string | null;
  modalidadeId: number | null;
  modalidadeNome: string | null;
  objeto: string | null;
  infoComplementar: string | null;
  situacaoId: number | null;
  situacaoNome: string | null;
  valorEstimadoCents: number | null;
  valorHomologadoCents: number | null;
  orcamentoSigiloso: boolean | null;
  dataPublicacao: string | null;
  aberturaRaw: string | null;
  aberturaUtc: string | null;
  encerramentoRaw: string | null;
  encerramentoUtc: string | null;
  prazoOrigem: string | null;
  linkPncp: string | null;
  linkOrigem: string | null;
  linkProcesso: string | null;
  sourceUpdatedUtc: string | null;
  raw: unknown;
}

export interface NormalizedItem {
  numeroItem: number;
  descricao: string | null;
  materialOuServico: string | null;
  quantidade: string | null;
  unidadeMedida: string | null;
  valorUnitario: string | null;
  valorTotalCents: number | null;
  sigiloso: boolean | null;
  situacao: string | null;
  categoria: string | null;
  infoComplementar: string | null;
}

export interface NormalizedDocument {
  sequencial: number;
  titulo: string | null;
  tipoId: number | null;
  tipoNome: string | null;
  url: string | null;
  dataPublicacao: string | null;
  ativo: boolean;
}

export type ListRoute = 'publicacao' | 'atualizacao' | 'proposta';

export interface ListQuery {
  route: ListRoute;
  dataInicial?: string; // YYYYMMDD
  dataFinal: string;
  modalidade?: number;
  uf?: string;
  pagina: number;
  tamanhoPagina: number;
}

export interface ListPage {
  records: NormalizedProcurement[];
  rejected: { index: number; reason: string }[];
  totalRegistros: number;
  totalPaginas: number;
  numeroPagina: number;
  empty: boolean;
}

export interface SourceConnector {
  readonly id: string;
  readonly label: string;
  /** Texto de cobertura exibido na tela de fontes. */
  coverage(modalidades: number[], ufs: string[]): string;
  listWindow(q: ListQuery, signal?: AbortSignal): Promise<ListPage>;
  fetchDetail(ref: ProcurementRef, signal?: AbortSignal): Promise<NormalizedProcurement>;
  fetchItems(ref: ProcurementRef, signal?: AbortSignal): Promise<NormalizedItem[]>;
  /** `interactive`: pedido do usuário, fora da fila da coleta. */
  fetchDocuments(ref: ProcurementRef, signal?: AbortSignal, opts?: { interactive?: boolean }): Promise<NormalizedDocument[]>;
  fetchModalidades(signal?: AbortSignal): Promise<{ id: number; nome: string; ativo: boolean }[]>;
  /** Baixa um anexo. Valida host, redirecionamentos, tamanho e tipo. */
  downloadDocument(ref: ProcurementRef, doc: NormalizedDocument, opts: { maxBytes: number; timeoutMs: number; signal?: AbortSignal; interactive?: boolean }): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }>;
}
