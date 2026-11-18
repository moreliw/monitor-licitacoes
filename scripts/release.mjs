// Publica uma versão no GitHub Releases (gratuito, sem assinatura):
//   npm version patch --no-git-tag-version   (ou minor)
//   npm run release -- "Texto das novidades"
// Gera o pacote portátil, o pacote de atualização e o manifesto, cria a tag e o Release.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const ver = pkg.version;
const notes = process.argv.slice(2).join(' ').trim();

try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); } catch { throw new Error('Faça login no GitHub: gh auth login'); }
try { execFileSync('gh', ['release', 'view', `v${ver}`], { stdio: 'ignore' }); throw new Error(`A versão v${ver} já foi publicada. Aumente a versão antes (npm version patch --no-git-tag-version).`); }
catch (e) { if (String(e.message).includes('já foi publicada')) throw e; }

execSync('node scripts/build-portable.mjs', { stdio: 'inherit', env: { ...process.env, RELEASE_NOTES: notes } });

const body = [
  notes ? `## Novidades\n${notes}\n` : '',
  '## Instalar (primeira vez)',
  `1. Baixe **MonitorLegislativo-${ver}-win-x64.zip**, clique com o botão direito e escolha **Extrair tudo**.`,
  '2. Abra a pasta extraída e dê dois cliques em **Monitor Legislativo.exe**.',
  '3. Escolha **Instalar**. O app cria o atalho no Menu Iniciar (e na área de trabalho, se marcado) e aparece em "Aplicativos instalados".',
  '',
  'Já tem o app instalado? Ele baixa esta versão sozinho e mostra **Atualizar agora**.',
].join('\n');
fs.writeFileSync('release/notes.md', body);

execFileSync('gh', ['release', 'create', `v${ver}`,
  `release/MonitorLegislativo-${ver}-win-x64.zip`, `release/app-${ver}.tar.gz`, 'release/app-latest.json',
  '--title', ver, '--notes-file', 'release/notes.md', '--target', 'main'], { stdio: 'inherit' });
console.log(`\nPublicado: https://github.com/moreliw/monitor-licitacoes/releases/tag/v${ver}`);
