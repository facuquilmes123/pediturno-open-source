// Local demos only; never submits a real booking or authenticates a customer.
const fs = require('node:fs');
const { chromium } = require('playwright');
const sharp = require('sharp');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3109';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('This UI exercise is local only');
const evidence = [];
const check = (condition, label) => { if (!condition) throw Error(label); evidence.push(label); };
(async () => {
  fs.mkdirSync('output/playwright', { recursive: true });
  fs.mkdirSync('public/images/producto', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--host-resolver-rules=MAP pediturno.com 127.0.0.1, MAP canchas.pediturno.com 127.0.0.1, MAP espacios.pediturno.com 127.0.0.1', '--no-proxy-server'] });
  try {
    for (const width of [1200, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' });
      context.setDefaultNavigationTimeout(120000);
      await context.addInitScript(() => localStorage.setItem('pediturno_analytics_consent_v1', 'rejected'));
      for (const [vertical, select] of [['servicios', /Seleccionar servicio Corte de cabello/], ['canchas', /Cancha de pádel 1/], ['espacios', /4 horas/]]) {
        const page = await context.newPage();
        const writes = [], availability = [], errors = [];
        page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) { if (r.method() !== 'GET') writes.push(r.url()); if (r.url().includes('/api/public/availability')) availability.push(r.url()); } });
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`${base}/demo-${vertical}`);
        const reject = page.getByRole('button', { name: 'Rechazar analítica' });
        if (await reject.count()) await reject.click();
        const demoUrl = page.url();
        for (const name of ['Contactar por WhatsApp', 'Instagram', 'Website', 'Cómo llegar']) {
          const button = page.getByRole('link', { name: new RegExp(`${name}$`) });
          check(await button.getAttribute('href') === '#contacto-demo', `demo ${vertical} ${width}: ${name} safe example link`);
          await button.click();
          await page.getByText('Contacto de ejemplo', { exact: true }).first().waitFor();
          check(page.url() === demoUrl && context.pages().length === 1, `demo ${vertical} ${width}: ${name} simulates without navigation`);
          await page.locator('[toast-close]').click();
        }
        check(await page.locator('header img').count() > 0, `demo ${vertical} ${width}: business profile image`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => Array.from(document.images).filter(img => img.getBoundingClientRect().top < innerHeight).every(img => img.complete && img.naturalWidth > 0));
        await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
        const screenshot = await page.screenshot({ path: `output/playwright/demo-${vertical}-${width}-20261010.png` });
        if (width === 1200 && process.argv.includes('--capture')) await sharp(screenshot).webp({ quality: 88 }).toFile(`public/images/producto/demo-${vertical}-20261010.webp`);
        await page.getByRole('button', { name: select }).first().click();
        // A future day avoids dependence on today's remaining hours (especially 4/8-hour blocks).
        await page.getByRole('gridcell').locator('button:not([disabled])').nth(1).click();
        const slots = page.getByRole('button', { name: /^\d\d:\d\d$/ });
        await slots.first().waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        check(!overflow, `demo ${vertical} ${width}: no horizontal overflow`);
        await slots.first().click();
        await page.getByRole('button', { name: 'Continuar con la Reserva' }).click();
        await page.getByRole('button', { name: 'Simular confirmación' }).click();
        await page.getByRole('heading', { name: 'Reserva de ejemplo completada' }).waitFor();
        check(writes.length === 0 && availability.length === 0, `demo ${vertical} ${width}: simulation without API writes or availability reads`);
        check(errors.length === 0, `demo ${vertical} ${width}: no browser exceptions`);
        await page.close();
      }
      for (const host of ['pediturno.com', 'canchas.pediturno.com', 'espacios.pediturno.com']) {
        const page = await context.newPage();
        // Render each host's server-selected vertical on localhost. Public-host
        // HTTP fixtures otherwise upgrade JS to HTTPS under the production CSP.
        await page.route(`${base}/`, async route => {
          const response = await route.fetch({ headers: { ...route.request().headers(), host: `${host}:${new URL(base).port}` } });
          await route.fulfill({ response });
        });
        await page.goto(`${base}/`);
        const ownOrigin = `https://${host}`;
        const recommendations = page.getByRole('contentinfo').getByRole('navigation', { name: 'Otros sistemas de Pediturno' });
        const targets = await recommendations.getByRole('link').evaluateAll(links => links.map(link => link.href));
        check(targets.length === 2 && ['https://pediturno.com', 'https://canchas.pediturno.com', 'https://espacios.pediturno.com'].filter(origin => origin !== ownOrigin).every(origin => targets.includes(`${origin}/`)), `${host} ${width}: footer recommends both other portals`);
        const carousel = page.getByRole('region', { name: /Ejemplos/ });
        check(await carousel.count() === 1, `${host} ${width}: benefit carousel in hero`);
        await carousel.getByRole('button', { name: 'Ver ejemplo siguiente' }).click();
        await carousel.getByRole('group', { name: /^2 de/ }).waitFor();
        check(await carousel.getByRole('group', { name: /^2 de/ }).count() === 1, `${host} ${width}: carousel changes slide`);
        await carousel.getByRole('button', { name: 'Ver ejemplo anterior' }).click();
        await carousel.getByRole('group', { name: /^1 de/ }).waitFor();
        await page.getByRole('heading', { name: 'Mirá cómo puede quedar tu negocio' }).scrollIntoViewIfNeeded();
        await page.waitForFunction(() => Array.from(document.images).filter(img => /demo-|servicios-agenda|canchas-disponibilidad|espacios-fechas/.test(img.currentSrc || img.src)).every(img => img.complete && img.naturalWidth > 0));
        check(await page.locator('img').evaluateAll(images => images.filter(img => /demo-|servicios-agenda|canchas-disponibilidad|espacios-fechas/.test(img.currentSrc || img.src)).every(img => img.complete && img.naturalWidth > 0)), `${host} ${width}: hero and product preview images loaded`);
        check(await page.getByRole('link', { name: 'Preguntas frecuentes', exact: true }).count() === 1, `${host} ${width}: FAQ linked`);
        check(await page.getByRole('link', { name: 'Términos', exact: true }).count() === 1, `${host} ${width}: terms linked`);
        check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `${host} ${width}: no horizontal overflow`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
        await page.screenshot({ path: `output/playwright/home-${host}-${width}-20261010.png` });
        await page.close();
      }
      await context.close();
    }
    if (process.argv.includes('--marketing-only')) {
      fs.writeFileSync('output/qa-marketing-ui.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks: evidence.length, evidence }, null, 2));
      console.log(JSON.stringify({ ok: true, checks: evidence.length }));
      return;
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    const analytics = [];
    let unsafeNetwork = false;
    page.on('request', r => { if (/google-analytics|googletagmanager/.test(r.url())) { analytics.push(true); if ((r.url() + (r.postData() || '')).includes('do-not-send')) unsafeNetwork = true; } });
    await page.goto(`${base}/?private_probe=do-not-send`);
    await page.getByRole('button', { name: 'Rechazar analítica' }).click();
    check(analytics.length === 0, 'analytics: no Google requests without consent');
    await page.getByRole('button', { name: 'Preferencias de privacidad' }).click();
    await page.getByRole('button', { name: 'Aceptar analítica' }).click();
    await page.waitForFunction(() => Array.from(window.dataLayer || []).some(a => a[0] === 'event' && a[1] === 'page_view'));
    const unsafe = await page.evaluate(() => JSON.stringify(Array.from(window.dataLayer || [])).includes('do-not-send'));
    check(!unsafe, 'analytics: page events exclude query strings');
    await page.waitForTimeout(1000);
    check(!unsafeNetwork, 'analytics: observed Google requests exclude query probe');
    await page.evaluate(() => history.pushState({}, '', '/pago/do-not-send?private_probe=do-not-send'));
    await page.waitForFunction(() => window['ga-disable-G-XXXXXXXXXX'] === true);
    await page.waitForTimeout(1500);
    check(!unsafeNetwork, 'analytics: public-to-private history navigation excludes private probe');
    await context.close();
    fs.writeFileSync('output/qa-audit-ui.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks: evidence.length, evidence }, null, 2));
    console.log(JSON.stringify({ ok: true, checks: evidence.length }));
  } finally { await browser.close(); }
})().catch(e => { console.error(JSON.stringify({ ok: false, error: e.message, evidence })); process.exitCode = 1; });
