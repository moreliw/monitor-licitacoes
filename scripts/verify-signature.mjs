// Confere a assinatura Authenticode do instalador e do executável gerados em release/.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rel = resolve('release');
const pkg = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8'));
const files = [
  join(rel, `monitor-licitacoes-setup-${pkg.version}.exe`),
  join(rel, 'win-unpacked', `${pkg.build.productName}.exe`),
].filter(existsSync);

if (!files.length) { console.error(`Nenhum arquivo da versão ${pkg.version} em release/. Rode "npm run dist" antes.`); process.exit(1); }

let ok = true;
for (const f of files) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${f.replace(/'/g, "''")}';
    [PSCustomObject]@{ Status = [string]$s.Status; Assinante = if ($s.SignerCertificate) { $s.SignerCertificate.GetNameInfo('SimpleName', $false) } else { '' };
      Carimbo = if ($s.TimeStamperCertificate) { $s.TimeStamperCertificate.GetNameInfo('SimpleName', $false) } else { '' } } | ConvertTo-Json -Compress`;
  const r = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }));
  const good = r.Status === 'Valid';
  ok &&= good;
  console.log(`${good ? 'OK ' : 'FALHA'}  ${f.replace(rel, 'release')}\n       status: ${r.Status}  assinante: ${r.Assinante || '—'}  carimbo de tempo: ${r.Carimbo || '—'}`);
}
if (!ok) { console.error('\nHá arquivos sem assinatura válida. Não publique esta versão.'); process.exit(1); }
console.log('\nAssinaturas válidas.');
void readdirSync;
