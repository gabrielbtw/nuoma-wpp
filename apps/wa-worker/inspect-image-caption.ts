import { chromium } from 'playwright';

(async () => {
  const phone = '5531982066263';
  const imagePath = '/Users/gabrielbraga/Projetos/nuoma-wpp/storage/uploads/media/temp/image/shared/0548e59b5399-Captura_de_Tela_2026-03-11_a_s_23.29.20.png';
  const context = await chromium.launchPersistentContext('/Users/gabrielbraga/Projetos/nuoma-wpp/storage/chromium-profile/whatsapp', {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--window-size=1512,920', '--force-device-scale-factor=1']
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`https://web.whatsapp.com/send?phone=${phone}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const attach = page.locator("button[title='Anexar'], div[title='Anexar'], span[data-icon='plus-rounded']").first();
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
  await attach.click();
  await page.getByText(/fotos e vídeos|fotos e videos/i).first().click();
  const chooser = await chooserPromise;
  await chooser.setFiles(imagePath);
  await page.waitForTimeout(4000);
  const editables = await page.locator("[contenteditable='true']").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      text: node.textContent,
      tab: node.getAttribute('data-tab'),
      role: node.getAttribute('role'),
      ariaLabel: node.getAttribute('aria-label'),
      html: node.outerHTML.slice(0, 500),
      rect: (() => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    }))
  );
  console.log(JSON.stringify(editables, null, 2));
  await page.screenshot({ path: '/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots/image-caption-debug.png', fullPage: true });
  await context.close();
})();
