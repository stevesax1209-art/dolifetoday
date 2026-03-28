import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(7000);

await page.check('#LOUD-0-1');
await page.check('#BIG-1-1');
await page.fill('#input-11', 'New York, NY');

await page.click('#combobox-button-13');
await page.waitForTimeout(500);
await page.locator('[role="option"][data-value="200"]').click();
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Submit Search' }).click();
await page.waitForTimeout(10000);

const foundText = await page.locator('body').innerText();
const m = foundText.match(/Found\s+(\d+)\s+Clinician\(s\)/i);
console.log('FOUND', m ? m[1] : 'NA');

const count = await page.locator('.clinician-list-base').count();
console.log('VISIBLE_LIST_ITEMS', count);

const samples = await page.$$eval('.clinician-list-base', (nodes) =>
  nodes.slice(0, 10).map((n) => ({
    text: (n.textContent || '').replace(/\s+/g, ' ').trim(),
    html: n.innerHTML,
  }))
);

console.log(JSON.stringify(samples, null, 2));

const classCounts = await page.$$eval('.clinician-datalist-left *', (nodes) => {
  const counts = new Map();
  for (const node of nodes) {
    const className = (node.className || '').toString();
    if (!className) continue;
    for (const cls of className.split(/\s+/).filter(Boolean)) {
      counts.set(cls, (counts.get(cls) || 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 60);
});

console.log('CLASS_COUNTS', JSON.stringify(classCounts, null, 2));

const parentSamples = await page.$$eval('.parent', (nodes) =>
  nodes.slice(0, 5).map((node) => {
    const getText = (sel) => {
      const el = node.querySelector(sel);
      return (el?.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const infoAnchor = node.querySelector('.clinician-detail-row1-middle a[data-id]');
    return {
      dataId: infoAnchor?.getAttribute('data-id') || '',
      row1: getText('.clinician-detail-row1-middle'),
      row2: getText('.clinician-detail-row2-middle'),
      row3: getText('.clinician-detail-row3-middle'),
      row4: getText('.clinician-detail-row4-middle'),
      row5: getText('.clinician-detail-row5-middle'),
      row6: getText('.clinician-detail-row6-middle'),
      website: getText('.website-area'),
      fullText: (node.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  })
);

console.log('PARENT_SAMPLES', JSON.stringify(parentSamples, null, 2));

await browser.close();
