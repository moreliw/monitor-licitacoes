// Gera a distribuição gratuita (sem instalador .exe, compatível com o Controle Inteligente de Aplicativos):
//   release/MonitorLegislativo-<versão>-win-x64.zip   pacote completo: Electron oficial INTACTO + app
//   release/app-<versão>.tar.gz                       só o app (JS, interface, módulos) para atualização
//   release/app-latest.json                           manifesto da atualização (versão, runtime, SHA-512)
// O executável é o electron.exe oficial apenas renomeado: mesmo arquivo, mesma reputação na Microsoft.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8')).version;
const ver = pkg.version;
const out = path.join(root, 'out');
const rel = path.join(root, 'release');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const EXE = 'Monitor Legislativo.exe';
const step = (m) => console.log(`\n> ${m}`);

if (!process.argv.includes('--skip-build')) {
  step('Compilando interface e processo principal');
  execSync('npm run icon', { stdio: 'inherit' });
  execSync('npm run build', { stdio: 'inherit' });
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(rel, { recursive: true });
const cp = (from, to, filter) => fs.cpSync(path.join(root, from), to, { recursive: true, filter });

// ---------- pacote do app (o que o atualizador baixa) ----------
step('Montando o pacote do app');
const bundle = path.join(out, 'bundle');
fs.mkdirSync(bundle, { recursive: true });
cp('dist-electron', path.join(bundle, 'dist-electron'), (src) => !src.includes(`${path.sep}tests`));
cp('dist/monitor-licitacoes/browser', path.join(bundle, 'dist', 'monitor-licitacoes', 'browser'));
fs.mkdirSync(path.join(bundle, 'build'));
fs.copyFileSync('build/icon.png', path.join(bundle, 'build', 'icon.png'));
fs.copyFileSync('build/icon.ico', path.join(bundle, 'build', 'icon.ico'));
// pdf.js: só a build "legacy" usada em Node, mais fontes e cmaps
const pdfKeep = ['package.json', 'LICENSE', 'legacy', 'cmaps', 'standard_fonts', 'wasm'];
cp('node_modules/pdfjs-dist', path.join(bundle, 'node_modules', 'pdfjs-dist'), (src) => {
  const relp = path.relative(path.join(root, 'node_modules', 'pdfjs-dist'), src);
  if (!relp) return true;
  const top = relp.split(path.sep)[0];
  if (!pdfKeep.includes(top)) return false;
  return !/\.map$/.test(src) && !/legacy[\\/]web/.test(relp) && !/legacy[\\/]image_decoders/.test(relp);
});
for (const m of ['@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc']) {
  if (fs.existsSync(path.join('node_modules', m))) cp(`node_modules/${m}`, path.join(bundle, 'node_modules', m));
}
fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({
  name: pkg.name, version: ver, description: pkg.description, author: pkg.author, main: 'dist-electron/main.js', runtime: electronVersion,
}, null, 2));

step('Compactando a atualização');
const tarName = `app-${ver}.tar.gz`;
const tarPath = path.join(rel, tarName);
fs.rmSync(tarPath, { force: true });
execFileSync(TAR, ['-czf', tarPath, '-C', bundle, '.'], { stdio: 'inherit' });
const tarBuf = fs.readFileSync(tarPath);
const manifest = {
  version: ver, runtime: electronVersion, file: tarName, size: tarBuf.length,
  sha512: createHash('sha512').update(tarBuf).digest('base64'),
  notes: process.env.RELEASE_NOTES || '',
};
fs.writeFileSync(path.join(rel, 'app-latest.json'), JSON.stringify(manifest, null, 2));

// ---------- pacote completo (zip) ----------
step('Montando o pacote completo com o Electron oficial');
const appDir = path.join(out, 'portable', 'Monitor Legislativo');
cp('node_modules/electron/dist', appDir, (src) => !src.endsWith('default_app.asar'));
fs.renameSync(path.join(appDir, 'electron.exe'), path.join(appDir, EXE));
const official = fs.readFileSync(path.join(root, 'node_modules/electron/dist/electron.exe'));
const shipped = fs.readFileSync(path.join(appDir, EXE));
if (!official.equals(shipped)) throw new Error('O executável foi alterado; ele precisa ser idêntico ao oficial.');
const res = path.join(appDir, 'resources', 'app');
fs.cpSync(bundle, path.join(res, 'app'), { recursive: true });
fs.copyFileSync('scripts/portable/bootstrap.js', path.join(res, 'bootstrap.js'));
fs.copyFileSync('build/icon.ico', path.join(res, 'icon.ico'));
// sem "productName": a pasta de dados continua %APPDATA%\monitor-licitacoes (mesma das versões anteriores)
fs.writeFileSync(path.join(res, 'package.json'), JSON.stringify({ name: pkg.name, version: ver, main: 'bootstrap.js' }, null, 2));
fs.writeFileSync(path.join(appDir, 'LEIA-ME.txt'), [
  'Monitor de Licitações Legislativas ' + ver + ' (Moreli.Dev)',
  '',
  'Para instalar: abra "Monitor Legislativo.exe" e escolha "Instalar".',
  'O app se copia para a pasta de programas, cria o atalho no Menu Iniciar (e na área de trabalho, se quiser)',
  'e aparece em "Aplicativos instalados", de onde também pode ser desinstalado.',
  '',
  'Se a versão anterior estiver aberta na bandeja, encerre-a antes (botão direito no ícone > Encerrar).',
].join('\r\n'));

step('Compactando o pacote completo');
const zipName = `MonitorLegislativo-${ver}-win-x64.zip`;
const zipPath = path.join(rel, zipName);
fs.rmSync(zipPath, { force: true });
execFileSync(TAR, ['-a', '-cf', zipPath, '-C', path.join(out, 'portable'), 'Monitor Legislativo'], { stdio: 'inherit' });

const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
console.log(`\nPronto (Electron ${electronVersion}):\n  ${zipName}  ${mb(zipPath)}\n  ${tarName}  ${mb(tarPath)}\n  app-latest.json`);
