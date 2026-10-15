/* =========================================================================
   Prueba de que el rol "employee" no ve costo ni margen -- no solo que la
   etiqueta del panel diga "Editor", sino que el numero de verdad no llegue
   al DOM. Usa el modo demo del panel (arranca sin token de GitHub con datos
   de ejemplo), asi que no necesita credenciales de nada.

   node tools/cost-visibility-test.mjs
   ========================================================================= */
import { chromium } from 'playwright';
const B = 'http://localhost:8138/bmxstore';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`  ${ok?'ok   ':'FALLA'} ${l}${ok?'':`  -> ${JSON.stringify(got)} (esperaba ${JSON.stringify(want)})`}`); };

async function loginAs(email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((email) => sessionStorage.setItem('stike_admin_login_v1', JSON.stringify({ email, ts: Date.now() })), email);
  await page.goto(`${B}/admin.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // deja correr seedDemoData() del modo demo
  return { page, context };
}

console.log('\nDUEÑO (jparra375): ve el campo de costo al editar un producto');
{
  const { page, context } = await loginAs('jparra375@gmail.com');
  await page.locator('[data-edit]').first().click();
  const html = await page.locator('#editor-drawer').innerHTML();
  t('el editor tiene un campo de costo', /id="ed-cost"|Costo/i.test(html), true);
  await context.close();
}

console.log('\nEMPLEADO (camilor95): el campo de costo NO aparece al editar');
{
  const { page, context } = await loginAs('camilor95@gmail.com');
  await page.locator('[data-edit]').first().click();
  const html = await page.locator('#editor-drawer').innerHTML();
  t('sin id="ed-cost" en el HTML', html.includes('id="ed-cost"'), false);
  t('sin la palabra "Costo" en el editor', />\s*Costo\s*</i.test(html), false);
  await context.close();
}

console.log('\nKPIs: el margen se oculta al empleado');
{
  const { page, context } = await loginAs('camilor95@gmail.com');
  await page.click('[data-panel="kpis"]');
  await page.waitForTimeout(200);
  const html = await page.locator('main').innerHTML();
  t('el dato de margen queda tras candado, no el numero', html.includes('class="locked"') && html.includes('solo dueño'), true);
  t('no se filtra el texto "Costo: $..." al empleado', /Costo:\s*\$[\d.]+/.test(html), false);
  await context.close();
}
{
  const { page, context } = await loginAs('jparra375@gmail.com');
  await page.click('[data-panel="kpis"]');
  await page.waitForTimeout(200);
  const html = await page.locator('main').innerHTML();
  t('el dueño ve "Margen bruto (30d)"', html.includes('Margen bruto (30d)'), true);
  t('el dueño NO ve el candado en ningún KPI', html.includes('class="locked"'), false);
  t('el dueño ve el costo en pesos', /Costo:\s*\$[\d.]+/.test(html), true);
  await context.close();
}

await browser.close();
console.log(fail ? `\n  ${fail} FALLARON\n` : '\n  todo pasó\n');
process.exit(fail ? 1 : 0);
