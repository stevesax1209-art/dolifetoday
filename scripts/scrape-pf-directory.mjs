#!/usr/bin/env node
/**
 * scrape-pf-directory.mjs
 *
 * Fetches all Parkinson's Foundation "In Your Area" locations via their
 * public JSON API and writes them to data/parkinsons-foundation/locations.json.
 *
 * Usage:  node scripts/scrape-pf-directory.mjs [--debug]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'data', 'parkinsons-foundation');
const outFile = resolve(outDir, 'locations.json');

const DEBUG = process.argv.includes('--debug');

const API = 'https://www.parkinson.org/api/map';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
  Referer: 'https://www.parkinson.org/resources-support/in-your-area',
};

/* ── helpers ─────────────────────────────────────────────── */

function decodeHtml(s) {
  if (!s) return '';
  return s
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\u0027/g, "'");
}

function parseRendered(html) {
  if (!html) return {};
  html = decodeHtml(html);

  // Type from eyebrow
  const typeM = html.match(/class="eyebrow">([^<]+)/);
  let type = typeM ? typeM[1].trim() : null;

  // Is chapter?
  const isChapter = html.includes('data-chapter="true"');
  if (!type && isChapter) type = 'Chapter';
  if (!type) type = 'Healthcare Location';

  // Address from -location class
  const addrM = html.match(/class="-location">([\s\S]*?)<\/p>/);
  let address = '';
  let city = '', stateProvince = '', postalCode = '';
  if (addrM) {
    // Address may contain <br /> separators
    const raw = addrM[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    address = raw.replace(/\n+/g, ', ');
    // Last line usually has "City, ST ZIP"
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';
    const csz = lastLine.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (csz) {
      city = csz[1];
      stateProvince = csz[2];
      postalCode = csz[3];
    }
  }

  // Phone
  const phoneM = html.match(/href="tel:([^"]+)"/);
  const phone = phoneM ? phoneM[1].trim() : '';

  // Medical professionals
  const professionals = [];
  const liRe = /<li>([^<]+)<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    professionals.push(m[1].trim());
  }

  // Services (for chapters)
  const services = [];
  const svcSection = html.match(/class="result-accordion-body">([\s\S]*?)<\/div>/);
  if (svcSection) {
    const svcRe = /<p[^>]*>([^<]+)<\/p>/g;
    while ((m = svcRe.exec(svcSection[1])) !== null) {
      services.push(m[1].trim());
    }
  }

  return { type, address, city, stateProvince, postalCode, phone, professionals, services };
}

/* ── main ────────────────────────────────────────────────── */

async function main() {
  console.log('Fetching from PF "In Your Area" API …');

  const url = `${API}?zip=66952&radius=2500&type=`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const data = await res.json();
  const raw = data.locations || [];
  console.log(`API returned ${raw.length} locations`);

  const records = raw.map((loc, idx) => {
    const parsed = parseRendered(loc.rendered);
    return {
      sourceId: `pf-${idx}`,
      name: decodeHtml(loc.title),
      type: parsed.type,
      latitude: loc.lat,
      longitude: loc.lng,
      zip: loc.zip,
      address: parsed.address,
      city: parsed.city,
      stateProvince: parsed.stateProvince,
      postalCode: parsed.postalCode,
      country: 'US',
      phone: parsed.phone,
      website: loc.website || '',
      note: loc.note || '',
      professionals: parsed.professionals,
      services: parsed.services,
    };
  });

  // Stats
  const types = {};
  const states = {};
  for (const r of records) {
    types[r.type] = (types[r.type] || 0) + 1;
    if (r.stateProvince) states[r.stateProvince] = (states[r.stateProvince] || 0) + 1;
  }
  console.log('\nBy type:');
  for (const [t, c] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c}`);
  }
  console.log(`\nStates covered: ${Object.keys(states).length}`);
  console.log('With professionals:', records.filter(r => r.professionals.length > 0).length);
  console.log('With phone:', records.filter(r => r.phone).length);
  console.log('With website:', records.filter(r => r.website).length);

  if (DEBUG) {
    // Show a few samples
    for (const r of records.slice(0, 5)) {
      console.log('\n', JSON.stringify(r, null, 2));
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(records, null, 2));
  console.log(`\nWrote ${records.length} records to ${outFile}`);
}

main().catch(e => { console.error(e); process.exit(1); });
