import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractTarGz, sha512File, validateManifest } from '../updater.ts';
import { compareVersions } from '../version.ts';

const good = { version: '1.3.1', runtime: '45.3.3', file: 'app-1.3.1.tar.gz', size: 1234, sha512: crypto.createHash('sha512').update('x').digest('base64') };

test('atualização: compara versões', () => {
  assert.ok(compareVersions('1.3.0', '1.2.9') > 0);
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.3.0', '1.3.0'), 0);
  assert.ok(compareVersions('1.2.1', '1.3.0') < 0);
});

test('atualização: manifesto é validado (nome do arquivo, hash, tamanho, versão)', () => {
  assert.deepEqual(validateManifest(good, '45.3.3').version, '1.3.1');
  for (const bad of [
    { ...good, file: '../../evil.exe' }, { ...good, file: 'app-1.3.1.exe' }, { ...good, version: '1.3' },
    { ...good, sha512: 'abc' }, { ...good, size: -1 }, { ...good, size: 10 ** 10 }, { ...good, runtime: undefined }, null,
  ]) assert.throws(() => validateManifest(bad, '45.3.3'), String(JSON.stringify(bad)).slice(0, 60));
});

test('atualização: SHA-512 do arquivo e extração com o tar.exe do Windows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'dist-electron'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ version: '1.3.1', main: 'dist-electron/main.js' }));
  fs.writeFileSync(path.join(src, 'dist-electron', 'main.js'), '// ok');
  const tgz = path.join(dir, 'app-1.3.1.tar.gz');
  execFileSync(path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'tar.exe'), ['-czf', tgz, '-C', src, '.']);
  const expected = crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  assert.equal(await sha512File(tgz), expected);
  const dest = path.join(dir, 'out');
  await extractTarGz(tgz, dest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version, '1.3.1');
  assert.ok(fs.existsSync(path.join(dest, 'dist-electron', 'main.js')));
  await assert.rejects(() => extractTarGz(path.join(dir, 'nao-existe.tar.gz'), path.join(dir, 'x')));
});
