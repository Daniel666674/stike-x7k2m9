/* =========================================================================
   Prueba de api/sync.php (actualizacion del sitio desde GitHub), sin red:

     node tools/sync-test.mjs        (necesita php, git y zip habilitado en php)

   Arma un repo de mentira con tres versiones del sitio, las sirve como ZIP con
   el mismo formato que GitHub (carpeta "repo-commit/" envolviendo todo) y
   levanta api/sync.php con php -S apuntando a ese servidor.
   ========================================================================= */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T = mkdtempSync(join(tmpdir(), 'stike-sync-'));
const TOKEN = 'token-de-prueba-0123456789-abcdefghij';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`);
};
const freePort = () => new Promise(res => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const git = (...args) => execFileSync('git', args, { cwd: join(T, 'repo'), encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

/* ---- repo de mentira: tres versiones ---- */
mkdirSync(join(T, 'repo/api'), { recursive: true });
mkdirSync(join(T, 'repo/data'), { recursive: true });
git('init', '-q');
const put = (rel, text) => { mkdirSync(join(T, 'repo', rel, '..'), { recursive: true }); writeFileSync(join(T, 'repo', rel), text); };
copyFileSync(join(ROOT, 'api/_lib.php'), join(T, 'repo/api/_lib.php'));
copyFileSync(join(ROOT, 'api/sync.php'), join(T, 'repo/api/sync.php'));
put('api/wompi-sign.php', '<?php // sign');
put('data/site-content.json', '{}');
put('.htaccess', '# v1');
put('index.html', 'v1');
put('page-a.html', 'a1');
put('page-b.html', 'b1');
put('api/config.local.php', '<?php return ["SYNC_TOKEN"=>"EVIL"];');   // nunca debe llegar al servidor
git('add', '-A'); git('commit', '-qm', 'v1'); const V1 = git('rev-parse', 'HEAD');
put('index.html', 'v2'); rmSync(join(T, 'repo/page-b.html')); put('page-c.html', 'c2');
git('add', '-A'); git('commit', '-qm', 'v2'); const V2 = git('rev-parse', 'HEAD');
rmSync(join(T, 'repo/index.html')); put('page-d.html', 'd3');
git('add', '-A'); git('commit', '-qm', 'v3 sin index'); const V3 = git('rev-parse', 'HEAD');
const zips = {};
for (const sha of [V1, V2, V3]) {
  const f = join(T, `${sha}.zip`);
  git('archive', '--format=zip', `--prefix=stike-x7k2m9-${sha}/`, '-o', f, sha);
  zips[sha] = readFileSync(f);
}

/* ---- servidor de "GitHub" ---- */
let hits = 0;
const gh = createServer((req, res) => {
  const sha = (req.url.match(/\/([0-9a-f]{40})\.zip$/) || [])[1];
  hits++;
  if (!zips[sha]) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': 'application/zip' }); res.end(zips[sha]);
});
const ghPort = await freePort();
await new Promise(r => gh.listen(ghPort, '127.0.0.1', r));

/* ---- sitio de mentira (public_html) ---- */
function makeSite(name, withToken) {
  const dir = join(T, name);
  mkdirSync(join(dir, 'api'), { recursive: true });
  copyFileSync(join(ROOT, 'api/_lib.php'), join(dir, 'api/_lib.php'));
  copyFileSync(join(ROOT, 'api/sync.php'), join(dir, 'api/sync.php'));
  writeFileSync(join(dir, 'api/config.local.php'), `<?php return ['STORAGE_DIR' => '${join(T, name + '-private')}'${withToken ? `, 'SYNC_TOKEN' => '${TOKEN}'` : ''}];`);
  writeFileSync(join(dir, 'mis-fotos.txt'), 'ajeno');
  return dir;
}
async function serve(dir) {
  const port = await freePort();
  const p = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore', env: { ...process.env, STIKE_SYNC_BASE: `http://127.0.0.1:${ghPort}/` } });
  await new Promise(r => setTimeout(r, 700));
  return { p, url: `http://127.0.0.1:${port}/api/sync.php` };
}
const call = async (url, { method = 'POST', token = TOKEN, body } = {}) => {
  const r = await fetch(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const site = makeSite('public_html', true);
const site2 = makeSite('public_html2', false);
const a = await serve(site);
const b = await serve(site2);
const rd = rel => (existsSync(join(site, rel)) ? readFileSync(join(site, rel), 'utf8') : null);
const state = () => JSON.parse(readFileSync(join(T, 'public_html-private/sync-state.json'), 'utf8'));

try {
  console.log('\nQuien puede llamarlo');
  t('sin SYNC_TOKEN en el servidor: 503', (await call(b.url, { body: { sha: V1 } })).status, 503);
  t('GET: 405', (await call(a.url, { method: 'GET' })).status, 405);
  t('sin token: 401', (await call(a.url, { token: null, body: { sha: V1 } })).status, 401);
  t('token equivocado: 401', (await call(a.url, { token: 'otro-token-que-no-es-el-correcto-123', body: { sha: V1 } })).status, 401);
  t('sha invalido: 400', (await call(a.url, { body: { sha: '../../etc/passwd' } })).status, 400);
  t('nada se descargo en todo eso', hits, 0);

  console.log('\nPrimera sincronizacion (v1)');
  let r = await call(a.url, { body: { sha: V1 } });
  t('responde updated', [r.status, r.json?.status], [200, 'updated']);
  t('index.html de v1', rd('index.html'), 'v1');
  t('api/config.local.php NO se sobrescribio', rd('api/config.local.php').includes(TOKEN), true);
  t('archivo ajeno intacto', rd('mis-fotos.txt'), 'ajeno');
  t('sin .part ni temporales en el sitio', readdirSync(site).filter(f => f.endsWith('.part')), []);
  t('sin temporales en la carpeta de datos', readdirSync(join(T, 'public_html-private')).filter(f => f.startsWith('sync') && f !== 'sync.lock' && f !== 'sync-state.json'), []);
  t('guarda el commit', state().sha, V1);

  console.log('\nMismo commit otra vez');
  const antes = hits;
  r = await call(a.url, { body: { sha: V1 } });
  t('up_to_date', r.json?.status, 'up_to_date');
  t('sin descargar nada', hits, antes);

  console.log('\nSegunda version (v2): cambia uno, borra uno, agrega uno');
  r = await call(a.url, { body: { sha: V2 } });
  t('updated', r.json?.status, 'updated');
  t('index.html cambio', rd('index.html'), 'v2');
  t('page-a.html sigue igual', rd('page-a.html'), 'a1');
  t('page-b.html (borrada del repo) se borro', rd('page-b.html'), null);
  t('page-c.html nueva', rd('page-c.html'), 'c2');
  t('archivo ajeno sigue intacto', rd('mis-fotos.txt'), 'ajeno');
  t('config.local.php sigue intacto', rd('api/config.local.php').includes(TOKEN), true);
  t('cuenta: borro 1', r.json?.deleted, 1);
  t('cuenta: reescribio solo lo que cambio (index + c = 2) y dejo el resto', [r.json?.written, r.json?.unchanged > 0], [2, true]);

  console.log('\nCommit que no existe');
  r = await call(a.url, { body: { sha: 'f'.repeat(40) } });
  t('error 500 sync_failed', [r.status, r.json?.error], [500, 'sync_failed']);
  t('el sitio sigue en v2', [rd('index.html'), state().sha], ['v2', V2]);

  console.log('\nZIP sin index.html (v3): no toca nada');
  r = await call(a.url, { body: { sha: V3 } });
  t('se niega', [r.status, r.json?.error], [500, 'sync_failed']);
  t('el sitio sigue completo en v2', [rd('index.html'), rd('page-c.html'), rd('page-d.html')], ['v2', 'c2', null]);
  t('el commit guardado sigue siendo v2', state().sha, V2);
} finally {
  a.p.kill(); b.p.kill(); gh.close();
  rmSync(T, { recursive: true, force: true });
}

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
