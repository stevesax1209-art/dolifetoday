#!/usr/bin/env node
/**
 * scrape-pmd-directory.mjs
 *
 * Scrapes all PMD Alliance directory listings via sitemap + individual pages.
 * Outputs to data/pmd-alliance/listings.json.
 *
 * Usage:
 *   node scripts/scrape-pmd-directory.mjs             # full run
 *   node scripts/scrape-pmd-directory.mjs --limit=5   # first 5 only
 *   node scripts/scrape-pmd-directory.mjs --debug      # verbose
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'data', 'pmd-alliance');
const outFile = resolve(outDir, 'listings.json');

const DEBUG = process.argv.includes('--debug');
const LIMIT = (() => {
  const m = process.argv.find(a => a.startsWith('--limit='));
  return m ? Number(m.split('=')[1]) : 0;
})();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const CONCURRENCY = 5;
const DELAY_MS = 300;

/* ── helpers ─────────────────────────────────────────────── */

function decodeHtml(s) {
  if (!s) return '';
  return s
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── 1. Get all listing URLs from sitemap ────────────────── */

async function getListingUrlsFromSitemap() {
  const url = 'https://www.pmdalliance.org/gd_place-sitemap.xml';
  console.log('Fetching sitemap:', url);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Sitemap returned ${res.status}`);
  const xml = await res.text();

  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
    .filter(u => u.includes('/listings/') && !u.includes('/category/') && !u.includes('/tags/'));

  console.log(`Sitemap contains ${urls.length} listing URLs`);
  return urls;
}

/* ── 2. Scrape a single listing page ─────────────────────── */

async function scrapeListing(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const html = await res.text();

  const slug = url.match(/\/listings\/([^/]+)\/?$/)?.[1] || '';

  // Name from <h1> or og:title
  const titleM = html.match(/<meta property="og:title"\s+content="([^"]+)"/);
  const name = decodeHtml(titleM?.[1] || '');

  // Description from og:description or meta description
  const descM = html.match(/<meta property="og:description"\s+content="([^"]+)"/);
  const description = decodeHtml(descM?.[1] || '');

  // Category (Group, Provider, Opportunity)
  const catM = html.match(/class="geodir-category[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</);
  const category = decodeHtml(catM?.[1] || '');

  // Tags (Featured, etc.)
  const tags = [];
  const tagRe = /class="gd-badge-meta[^"]*"[^>]*>([^<]+)/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) tags.push(decodeHtml(m[1]));

  // Phone
  const phoneM = html.match(/href="tel:([^"]+)"/);
  const phone = phoneM ? phoneM[1].trim() : '';

  // Website
  const websiteM = html.match(/class="geodir-i-website[^"]*"[^>]*>[\s\S]*?href="([^"]+)"/);
  const website = websiteM ? websiteM[1] : '';

  // Email
  const emailM = html.match(/href="mailto:([^"]+)"/);
  const email = emailM ? emailM[1].trim() : '';

  // Address from geodir-i-address or structured data
  const addrM = html.match(/class="geodir-i-address[^"]*"[\s\S]*?<span[^>]*>([^<]+)/);
  const address = decodeHtml(addrM?.[1] || '');

  // Lat/Lng from geodir map data
  const latM = html.match(/data-lat="([^"]+)"/);
  const lngM = html.match(/data-lng="([^"]+)"/);
  const lat = latM ? parseFloat(latM[1]) : null;
  const lng = lngM ? parseFloat(lngM[1]) : null;

  // Region/City from geodir
  const regionM = html.match(/class="geodir-i-region[^"]*"[\s\S]*?<a[^>]*>([^<]+)/);
  const region = decodeHtml(regionM?.[1] || '');
  const cityM = html.match(/class="geodir-i-city[^"]*"[\s\S]*?<a[^>]*>([^<]+)/);
  const city = decodeHtml(cityM?.[1] || '');

  // Business hours / format (Virtual, In-person, etc.)
  const formats = [];
  if (/\bVirtual\b/i.test(html)) formats.push('virtual');
  if (/\bIn-person\b/i.test(html)) formats.push('in-person');

  // Cost info
  const costM = html.match(/class="geodir-i-cost[^"]*"[\s\S]*?<span[^>]*>([^<]+)/);
  const cost = decodeHtml(costM?.[1] || '');

  // Custom fields: check for all geodir_cf_ classes
  const extraFields = {};
  const cfRe = /class="geodir-i-([a-z_]+)[^"]*"[\s\S]*?<span[^>]*>([^<]+)/g;
  while ((m = cfRe.exec(html)) !== null) {
    const key = m[1].replace(/^geodir_cf_/, '');
    if (!['address', 'phone', 'website', 'email', 'region', 'city'].includes(key)) {
      extraFields[key] = decodeHtml(m[2]);
    }
  }

  // JSON-LD structured data
  let jsonLd = null;
  const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (ldMatch) {
    try { jsonLd = JSON.parse(ldMatch[1]); } catch {}
  }

  // Extract state from region or address
  let stateProvince = '';
  let country = 'US';
  // Try from JSON-LD
  if (jsonLd?.address?.addressRegion) stateProvince = jsonLd.address.addressRegion;
  if (jsonLd?.address?.addressCountry) country = jsonLd.address.addressCountry;
  
  // Fallback: parse from address or region
  if (!stateProvince && region) {
    // Region might be state name or abbreviation
    stateProvince = region;
  }

  return {
    sourceUrl: url,
    slug,
    name,
    description,
    category,
    tags,
    phone,
    email,
    website,
    address,
    city,
    stateProvince,
    country,
    latitude: lat,
    longitude: lng,
    formats,
    cost,
    extraFields,
    jsonLd: jsonLd?.address ? {
      streetAddress: jsonLd.address.streetAddress || '',
      addressLocality: jsonLd.address.addressLocality || '',
      addressRegion: jsonLd.address.addressRegion || '',
      postalCode: jsonLd.address.postalCode || '',
      addressCountry: jsonLd.address.addressCountry || '',
    } : null,
  };
}

/* ── 3. Parallel scraper with throttling ─────────────────── */

async function scrapeAll(urls) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      const url = urls[i];
      try {
        const data = await scrapeListing(url);
        if (data) {
          results.push(data);
          if ((i + 1) % 20 === 0 || DEBUG) {
            console.log(`  [${i + 1}/${urls.length}] ${data.name} (${data.category})`);
          }
        } else {
          console.log(`  [${i + 1}] SKIP (non-200): ${url}`);
        }
      } catch (e) {
        console.log(`  [${i + 1}] ERROR: ${url} - ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return results;
}

/* ── main ────────────────────────────────────────────────── */

async function main() {
  let urls = await getListingUrlsFromSitemap();
  if (LIMIT > 0) {
    urls = urls.slice(0, LIMIT);
    console.log(`Limited to first ${LIMIT} URLs`);
  }

  console.log(`Scraping ${urls.length} listing pages (concurrency=${CONCURRENCY}) …\n`);
  const records = await scrapeAll(urls);

  // Stats
  const cats = {};
  for (const r of records) cats[r.category || 'unknown'] = (cats[r.category || 'unknown'] || 0) + 1;
  console.log(`\nScraped ${records.length} listings`);
  console.log('By category:');
  for (const [c, n] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }
  console.log('With phone:', records.filter(r => r.phone).length);
  console.log('With website:', records.filter(r => r.website).length);
  console.log('With lat/lng:', records.filter(r => r.latitude && r.longitude).length);
  console.log('With address:', records.filter(r => r.address).length);
  console.log('Formats:', JSON.stringify(
    records.reduce((acc, r) => { for (const f of r.formats) acc[f] = (acc[f] || 0) + 1; return acc; }, {}),
  ));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(records, null, 2));
  console.log(`\nWrote ${records.length} records to ${outFile}`);
}

main().catch(e => { console.error(e); process.exit(1); });
