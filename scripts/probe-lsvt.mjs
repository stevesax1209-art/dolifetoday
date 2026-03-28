import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(12000);

const text = await page.locator('body').innerText();
console.log(text.slice(0, 2200));

const fields = await page.$$eval('input,select,button,textarea', (els) =>
  els.map((e) => ({
    tag: e.tagName.toLowerCase(),
    type: e.getAttribute('type') || '',
    id: e.id || '',
    name: e.getAttribute('name') || '',
    placeholder: e.getAttribute('placeholder') || '',
    aria: e.getAttribute('aria-label') || '',
    text: (e.textContent || '').trim().slice(0, 80),
    value: (e.value || '').trim().slice(0, 80),
    className: e.className || '',
  }))
);

console.log('FIELDS', fields.length);
console.log(JSON.stringify(fields.slice(0, 100), null, 2));

await browser.close();
