// Carregador do Monitor de Licitações (pacote portátil).
// Escolhe entre a versão que veio no pacote e a mais nova baixada pelo atualizador
// (%LOCALAPPDATA%\monitor-licitacoes\versoes\<versão>). Se a versão nova não chegar a abrir a janela
// duas vezes seguidas, volta para a versão do pacote.
'use strict';
const path = require('path');
const fs = require('fs');

const own = require('./package.json');
const base = path.join(process.env.LOCALAPPDATA || '', 'monitor-licitacoes', 'versoes');
const bootFile = path.join(base, 'boot.json');

function cmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

let dir = path.join(__dirname, 'app');
let version = own.version;
let main = 'dist-electron/main.js';

const cur = readJson(path.join(base, 'current.json'));
if (cur && /^\d+\.\d+\.\d+$/.test(cur.version) && cmp(cur.version, own.version) > 0) {
  const candidate = path.join(base, cur.version);
  const pkg = readJson(path.join(candidate, 'package.json'));
  const boot = readJson(bootFile) || {};
  const failures = boot.version === cur.version ? boot.failures || 0 : 0;
  if (pkg && pkg.version === cur.version && pkg.runtime === process.versions.electron && fs.existsSync(path.join(candidate, pkg.main)) && failures < 2) {
    dir = candidate; version = pkg.version; main = pkg.main;
    // conta a tentativa; o app zera o contador quando a janela carrega
    try { fs.writeFileSync(bootFile, JSON.stringify({ version, failures: failures + 1 })); } catch { /* ignora */ }
  }
}

function start(d, v, m) {
  process.env.MONITOR_APP_VERSION = v;
  process.env.MONITOR_APP_DIR = d;
  process.env.MONITOR_PORTABLE = '1';
  require(path.join(d, m));
}

const bundledDir = path.join(__dirname, 'app');
if (dir === bundledDir) {
  start(dir, version, main);
} else {
  try {
    start(dir, version, main);
  } catch (e) {
    // a versão baixada falhou ao carregar: registra e usa a do pacote
    try { fs.writeFileSync(bootFile, JSON.stringify({ version, failures: 99, erro: String(e && e.message || e).slice(0, 300) })); } catch { /* ignora */ }
    start(bundledDir, own.version, 'dist-electron/main.js');
  }
}
