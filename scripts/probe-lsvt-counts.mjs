import { chromium } from 'playwright';

const locations = [
  'New York, NY',
  'Los Angeles, CA',
  'Chicago, IL',
  'London, UK',
  'Toronto, ON',
  'Sydney, Australia',
  'United States',
  'Canada',
  'Germany',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(7000);

await page.check('#LOUD-0-1');
await page.check('#BIG-1-1');

for (const loc of locations) {
  await page.fill('#input-11', '');
  await page.fill('#input-11', loc);
  await page.getByRole('button', { name: 'Submit Search' }).click();
  await page.waitForTimeout(7000);
  const body = await page.locator('body').innerText();
  const m = body.match(/Found\s+(\d+)\s+Clinician\(s\)/i);
  console.log(`${loc} => ${m ? m[1] : 'NA'}`);
}

await browser.close();
