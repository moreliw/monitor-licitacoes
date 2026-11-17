/** CSV UTF-8 (com BOM, separador ";" para o Excel pt-BR) protegido contra injeção de fórmulas. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r\n|\r|\n/g, ' ');
  // Planilhas interpretam =, +, -, @, TAB e CR no início como fórmula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
