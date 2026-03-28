import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(8000);

const modalCount = await page.locator('.slds-modal__container').count();
console.log('MODAL_COUNT', modalCount);

if (modalCount > 0) {
  const text = await page.locator('.slds-modal__container').first().innerText();
  console.log('MODAL_TEXT_START');
  console.log(text.slice(0, 2000));
  console.log('MODAL_TEXT_END');

  const closeButtons = await page.$$eval('.slds-modal__container button, .slds-modal__container [role="button"]', (nodes) =>
    nodes.map((n) => ({ text: (n.textContent || '').trim(), aria: n.getAttribute('aria-label') || '', className: n.className || '' }))
  );
  console.log('MODAL_BUTTONS', JSON.stringify(closeButtons, null, 2));
}

await page.screenshot({ path: 'data/lsvt/modal-debug.png', fullPage: true });
await browser.close();
