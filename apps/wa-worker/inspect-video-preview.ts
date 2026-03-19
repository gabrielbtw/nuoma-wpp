import { chromium } from 'playwright';

(async () => {
  const phone = '5531982066263';
  const videoPath = '/Users/gabrielbraga/Desktop/WhatsApp Video 2025-03-06 at 17.45.41.mp4';
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
  const photos = page.getByText(/fotos e vídeos|fotos e videos/i).first();
  await photos.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(videoPath);
  await page.waitForTimeout(5000);
  const sends = await page.locator("button[aria-label='Enviar'], div[aria-label='Enviar']").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      tag: node.tagName,
      text: node.textContent,
      html: node.outerHTML.slice(0, 500),
      rect: (() => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    }))
  );
  console.log(JSON.stringify(sends, null, 2));
  await page.screenshot({ path: '/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots/video-preview-debug.png', fullPage: true });
  await context.close();
})();
