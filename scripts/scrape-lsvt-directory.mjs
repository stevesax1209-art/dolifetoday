import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const rootDir = process.cwd();
const seedFile = process.argv[2] || path.join(rootDir, 'scripts', 'lsvt-seed-locations.txt');
const outDir = path.join(rootDir, 'data', 'lsvt');
const checkpointPath = path.join(outDir, 'checkpoint.json');
const jsonOut = path.join(outDir, 'clinicians.json');
const csvOut = path.join(outDir, 'clinicians.csv');

function readLines(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function keyFor(record) {
  if (record.dataId) return `id:${record.dataId}`;
  return [record.name, record.phone, record.email, record.organization].join('|').toLowerCase();
}

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

async function ensureChecked(page, selector) {
  if (!(await page.isChecked(selector))) {
    await page.check(selector);
  }
}

async function setRadius200(page) {
  await page.click('#combobox-button-13');
  await page.waitForTimeout(300);
  const option = page.locator('[role="option"][data-value="200"]');
  if (await option.count()) {
    await option.first().click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(200);
}

async function parseFoundCount(page) {
  const text = await page.locator('body').innerText();
  const match = text.match(/Found\s+(\d+)\s+Clinician\(s\)/i);
  return match ? Number(match[1]) : null;
}

async function extractClinicians(page, queryLocation) {
  return page.$$eval('.parent', (nodes, location) => {
    const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const getText = (node, selector) => {
      const el = node.querySelector(selector);
      return norm(el?.textContent || '');
    };

    return nodes.map((node) => {
      const infoAnchor = node.querySelector('.clinician-detail-row1-middle a[data-id]');
      const websiteAnchor = node.querySelector('.website-area a[href]');
      return {
        dataId: infoAnchor?.getAttribute('data-id') || '',
        name: getText(node, '.clinician-detail-row1-middle'),
        role: getText(node, '.clinician-detail-row2-middle'),
        credentials: getText(node, '.clinician-detail-row3-middle'),
        organization: getText(node, '.clinician-detail-row4-middle'),
        phone: getText(node, '.clinician-detail-row5-middle'),
        email: getText(node, '.clinician-detail-row6-middle'),
        website: websiteAnchor?.getAttribute('href') || '',
        sourceLocation: location,
      };
    });
  }, queryLocation);
}

async function clickSubmit(page) {
  const candidates = [
    page.locator('button', { hasText: 'Submit Search' }).first(),
    page.getByText('Submit Search', { exact: true }).first(),
    page.locator('#searchButton-0 button').first(),
  ];

  for (const locator of candidates) {
    if (await locator.count()) {
      await locator.click({ timeout: 15000 });
      return;
    }
  }

  throw new Error('Submit Search button not found');
}

async function dismissModalOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    const modal = page.locator('.slds-modal__container').first();
    if (!(await modal.count())) return;

    const closeButton = modal.locator('button', { hasText: 'Close' }).first();
    if (await closeButton.count()) {
      await closeButton.click({ force: true }).catch(() => {});
    }

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const seeds = readLines(seedFile);

  let state = {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedLocations: [],
    clinicians: [],
  };

  if (fs.existsSync(checkpointPath)) {
    state = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  }

  const completed = new Set(state.completedLocations || []);
  const clinicianMap = new Map((state.clinicians || []).map((c) => [keyFor(c), c]));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.lsvtglobal.com/LSVTFindClinicians', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForTimeout(7000);

  await ensureChecked(page, '#LOUD-0-1');
  await ensureChecked(page, '#BIG-1-1');
  await setRadius200(page);
  await dismissModalOverlays(page);

  for (const location of seeds) {
    if (completed.has(location)) {
      console.log(`SKIP ${location}`);
      continue;
    }

    console.log(`SEARCH ${location}`);
    await page.fill('#input-11', '');
    await page.fill('#input-11', location);
    await dismissModalOverlays(page);
    await clickSubmit(page);
    await page.waitForTimeout(9000);

    const found = await parseFoundCount(page);
    const rows = await extractClinicians(page, location);

    for (const row of rows) {
      row.foundCountForLocation = found;
      row.scrapedAt = new Date().toISOString();
      const key = keyFor(row);
      if (!clinicianMap.has(key)) {
        clinicianMap.set(key, row);
      }
    }

    completed.add(location);

    state.updatedAt = new Date().toISOString();
    state.completedLocations = Array.from(completed);
    state.clinicians = Array.from(clinicianMap.values());
    fs.writeFileSync(checkpointPath, JSON.stringify(state, null, 2));

    console.log(`DONE ${location} found=${found ?? 'NA'} rows=${rows.length} unique=${clinicianMap.size}`);
  }

  await browser.close();

  const clinicians = Array.from(clinicianMap.values()).map((c) => ({
    ...c,
    name: normalize(c.name),
    role: normalize(c.role),
    credentials: normalize(c.credentials),
    organization: normalize(c.organization),
    phone: normalize(c.phone),
    email: normalize(c.email),
  }));

  fs.writeFileSync(jsonOut, JSON.stringify(clinicians, null, 2));

  const headers = [
    'dataId',
    'name',
    'role',
    'credentials',
    'organization',
    'phone',
    'email',
    'website',
    'sourceLocation',
    'foundCountForLocation',
    'scrapedAt',
  ];

  const csv = [headers.join(',')]
    .concat(
      clinicians.map((row) =>
        headers.map((header) => csvEscape(row[header] ?? '')).join(',')
      )
    )
    .join('\n');

  fs.writeFileSync(csvOut, csv, 'utf8');

  console.log(`\nWROTE ${jsonOut}`);
  console.log(`WROTE ${csvOut}`);
  console.log(`TOTAL UNIQUE CLINICIANS: ${clinicians.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
