import { chromium } from 'playwright';

(async () => {
  const phone = '5531982066263';
  const context = await chromium.launchPersistentContext('/Users/gabrielbraga/Projetos/nuoma-wpp/storage/chromium-profile/whatsapp', {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--window-size=1512,920', '--force-device-scale-factor=1']
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`https://web.whatsapp.com/send?phone=${phone}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.locator("button[title='Anexar'], div[title='Anexar'], span[data-icon='plus-rounded']").first().click();
  await page.waitForTimeout(1500);
  const menuItems = await page.locator("[role='button'], button, div").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        text: (node.textContent || '').trim(),
        role: node.getAttribute('role'),
        aria: node.getAttribute('aria-label'),
        html: node.outerHTML.slice(0, 220)
      }))
      .filter((item) => /áudio|audio|fotos e vídeos|documento|figurinha/i.test(item.text))
  );
  const inputs = await page.locator("input[type='file']").evaluateAll((nodes) =>
    nodes.map((node, index) => ({ index, accept: node.getAttribute('accept'), outer: node.outerHTML.slice(0, 200) }))
  );
  console.log(JSON.stringify({ menuItems, inputs }, null, 2));
  await page.screenshot({ path: '/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots/audio-menu-debug.png', fullPage: true });
  await context.close();
})();
