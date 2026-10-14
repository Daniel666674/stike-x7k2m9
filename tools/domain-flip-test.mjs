/* =========================================================================
   Prueba del cambio de dominio, de punta a punta y sin tocar el repo.

     node tools/domain-flip-test.mjs

   Copia el repo a una carpeta temporal, cambia DOMAIN/BASE_PATH en
   assets/js/site.js de la COPIA a stikebikeshop.com + "/", corre
   tools/build-pages.mjs ahi y revisa que no quede ni rastro de la ruta vieja
   de GitHub Pages (/stike-x7k2m9/) en ninguna URL: ni <base href>, ni
   canonical, ni og:url/og:image, ni el sitemap, ni el robots.txt. Despues
   hace el camino de vuelta, porque el script tiene que poder ir y volver.

   Por que existe: la primera vez que se probo este cambio, las paginas fijas
   (blog, envios, terminos...) quedaron con canonical y og:image apuntando a
   https://stikebikeshop.com/stike-x7k2m9/... -- una direccion que no existe.
   Sin esta prueba eso se descubre despues de publicar, cuando Google y
   WhatsApp ya leyeron las URL rotas.
   ========================================================================= */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${label}${ok ? '' : `  -> dio ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`);
};

const work = mkdtempSync(join(tmpdir(), 'stike-flip-'));
cpSync(ROOT, work, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(relative(ROOT, src)) });

const setSite = (domain, basePath) => {
  const p = join(work, 'assets/js/site.js');
  writeFileSync(p, readFileSync(p, 'utf8')
    .replace(/(var DOMAIN\s*=\s*)"[^"]*"/, `$1"${domain}"`)
    .replace(/(var BASE_PATH\s*=\s*)"[^"]*"/, `$1"${basePath}"`));
};
const build = (...args) => execFileSync('node', [join(work, 'tools/build-pages.mjs'), ...args], { cwd: work, encoding: 'utf8' });

/* Todos los .html/.xml/.txt que se publican (sin herramientas ni backends). */
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    const rel = relative(work, abs);
    if (/^(tools|vercel-wompi-api|bmx-builder|node_modules|\.git)(\/|$)/.test(rel)) continue;
    if (e.isDirectory()) walk(abs);
    else if (/\.(html|xml|txt)$/.test(e.name)) files.push(rel);
  }
})(work);
const grep = (re) => files.filter(f => re.test(readFileSync(join(work, f), 'utf8')));

try {
  console.log('\nHacia stikebikeshop.com (BASE_PATH "/")');
  setSite('stikebikeshop.com', '/');
  build();
  t('ninguna pagina conserva el <base href> de GitHub Pages', grep(/<base href="\/stike-x7k2m9\/">/), []);
  t('todas las paginas con base usan "/"', grep(/<base href="\/">/).length > 100, true);
  t('ninguna URL absoluta lleva la ruta vieja /stike-x7k2m9/', grep(/https:\/\/stikebikeshop\.com\/stike-x7k2m9/), []);
  t('ninguna URL sigue en github.io', grep(/https:\/\/daniel666674\.github\.io/), []);
  const robots = readFileSync(join(work, 'robots.txt'), 'utf8');
  t('robots.txt apunta al sitemap del dominio nuevo', /^Sitemap: https:\/\/stikebikeshop\.com\/sitemap\.xml$/m.test(robots), true);
  const sitemap = readFileSync(join(work, 'sitemap.xml'), 'utf8');
  t('el sitemap lista la portada en el dominio nuevo', sitemap.includes('<loc>https://stikebikeshop.com/</loc>'), true);
  const blog = readFileSync(join(work, 'blog.html'), 'utf8');
  t('una pagina fija: canonical limpio', blog.includes('<link rel="canonical" href="https://stikebikeshop.com/blog.html">'), true);
  t('una pagina fija: og:image limpio', blog.includes('content="https://stikebikeshop.com/assets/img/og-stike.jpg"'), true);
  t('segunda corrida sin cambios (idempotente)', /0 cambiarian/.test(build('--check')), true);

  console.log('\nDe vuelta a GitHub Pages (BASE_PATH "/stike-x7k2m9/")');
  setSite('daniel666674.github.io', '/stike-x7k2m9/');
  build();
  t('las URL vuelven a la ruta de Pages', grep(/https:\/\/daniel666674\.github\.io\/stike-x7k2m9\/blog\.html/).includes('blog.html'), true);
  t('ninguna URL se duplica (/stike-x7k2m9/stike-x7k2m9/)', grep(/stike-x7k2m9\/stike-x7k2m9/), []);
  t('no queda el dominio nuevo', grep(/https:\/\/stikebikeshop\.com/), []);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n  ${pass} pasaron, ${fail} fallaron\n`);
process.exit(fail ? 1 : 0);
