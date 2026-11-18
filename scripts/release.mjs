// Publica uma versão no GitHub Releases: confere o certificado, gera e assina, verifica a assinatura e publica.
// Uso:  npm run release            (exige CERTUM_CERT_SHA1 e SimplySign conectado)
//       npm run release -- --unsigned   (força publicação sem assinatura; não recomendado)
import { execSync } from 'node:child_process';

const unsigned = process.argv.includes('--unsigned');
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

if (!unsigned) run('node scripts/signing-check.mjs');
const token = process.env.GH_TOKEN || execSync('gh auth token', { encoding: 'utf8' }).trim();
if (!token) throw new Error('Sem token do GitHub: rode "gh auth login".');

run('node scripts/make-icon.mjs');
run('npm run build');
run('npx electron-builder --config electron-builder.config.cjs --win nsis --x64 --publish always', {
  GH_TOKEN: token, MONITOR_RELEASE: '1', ...(unsigned ? { MONITOR_ALLOW_UNSIGNED: '1' } : {}),
});
if (!unsigned) run('node scripts/verify-signature.mjs');
console.log('\nVersão publicada. Confira em https://github.com/moreliw/monitor-licitacoes/releases');
