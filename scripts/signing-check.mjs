// Lista os certificados de assinatura de código disponíveis no Windows (o SimplySign Desktop conectado
// expõe o certificado da Certum aqui) e confere o CERTUM_CERT_SHA1 configurado.
import { execFileSync } from 'node:child_process';

const ps = `Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert | ForEach-Object {
  [PSCustomObject]@{ Thumbprint = $_.Thumbprint; Subject = $_.Subject; CN = $_.GetNameInfo('SimpleName', $false); Emissor = $_.GetNameInfo('SimpleName', $true); Validade = $_.NotAfter.ToString('dd/MM/yyyy'); ChavePrivada = $_.HasPrivateKey }
} | ConvertTo-Json -Compress`;

let certs = [];
try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim();
  certs = out ? [].concat(JSON.parse(out)) : [];
} catch (e) {
  console.error('Não foi possível ler o repositório de certificados do Windows:', e.message);
  process.exit(1);
}

if (!certs.length) {
  console.log('Nenhum certificado de assinatura de código encontrado em CurrentUser\\My.');
  console.log('Abra o SimplySign Desktop, use "Connect to SimplySign" e digite o código do app no celular; depois rode de novo.');
  process.exit(1);
}

console.log('Certificados de assinatura de código encontrados:\n');
for (const c of certs) {
  console.log(`  CN:            ${c.CN}`);
  console.log(`  Emissor:       ${c.Emissor}`);
  console.log(`  Thumbprint:    ${c.Thumbprint}`);
  console.log(`  Validade até:  ${c.Validade}   Chave privada: ${c.ChavePrivada ? 'sim' : 'NÃO'}\n`);
}

const want = (process.env.CERTUM_CERT_SHA1 || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
if (!want) {
  const certum = certs.find((c) => /certum/i.test(c.Emissor)) ?? certs[0];
  console.log('Defina no PowerShell antes de publicar (exemplo com o certificado Certum encontrado):\n');
  console.log(`  $env:CERTUM_CERT_SHA1 = "${certum.Thumbprint}"`);
  console.log(`  $env:CERTUM_PUBLISHER_NAME = "${certum.CN}"`);
  process.exit(0);
}
const hit = certs.find((c) => c.Thumbprint.toUpperCase() === want);
if (!hit) { console.error(`CERTUM_CERT_SHA1 (${want}) não está disponível. O SimplySign Desktop está conectado?`); process.exit(1); }
if (!hit.ChavePrivada) { console.error('O certificado foi encontrado, mas sem chave privada acessível. Reconecte o SimplySign Desktop.'); process.exit(1); }
const pub = (process.env.CERTUM_PUBLISHER_NAME || '').trim();
if (pub && pub !== hit.CN) console.warn(`Atenção: CERTUM_PUBLISHER_NAME ("${pub}") difere do CN do certificado ("${hit.CN}"). O atualizador recusaria as atualizações.`);
console.log(`OK: certificado pronto para assinar (${hit.CN}).`);
