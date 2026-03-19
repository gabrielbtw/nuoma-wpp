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
  await page.waitForTimeout(8000);
  await page.screenshot({ path: '/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots/chat-inspect-caption-final.png', fullPage: true });
  await context.close();
})();
