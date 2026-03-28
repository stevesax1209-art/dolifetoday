import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(7000);

await page.check('#BIG-1-1');
await page.fill('#input-11', 'United States');
await page.getByRole('button', { name: 'Submit Search' }).click();

await page.waitForTimeout(12000);

const bodyText = await page.locator('body').innerText();
console.log('BODY_PREVIEW_START');
console.log(bodyText.slice(0, 5000));
console.log('BODY_PREVIEW_END');

const links = await page.$$eval('a', (nodes) =>
  nodes
    .map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') || '' }))
    .filter((x) => x.text || x.href)
    .slice(0, 120)
);

const buttons = await page.$$eval('button', (nodes) =>
  nodes.map((b) => ({ text: (b.textContent || '').trim(), id: b.id || '', className: b.className || '' }))
);

console.log('LINKS', JSON.stringify(links, null, 2));
console.log('BUTTONS', JSON.stringify(buttons, null, 2));

await page.content().then((html) => {
  const lines = html.split('\n');
  const interesting = lines.filter((l) => /result|pagination|next|previous|clinician|provider|card|list/i.test(l));
  console.log('INTERESTING_LINES_SAMPLE_START');
  console.log(interesting.slice(0, 200).join('\n'));
  console.log('INTERESTING_LINES_SAMPLE_END');
});

await browser.close();
