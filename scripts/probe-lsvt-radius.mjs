import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(7000);

await page.click('#combobox-button-13');
await page.waitForTimeout(1000);

const options = await page.$$eval('[role="option"]', (nodes) =>
  nodes.map((n) => ({
    text: (n.textContent || '').trim(),
    id: n.id || '',
    aria: n.getAttribute('aria-label') || '',
    dataValue: n.getAttribute('data-value') || '',
    outerHtml: n.outerHTML,
  }))
);

console.log(JSON.stringify(options, null, 2));
await browser.close();
