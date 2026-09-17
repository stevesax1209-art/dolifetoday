#!/usr/bin/env node
/**
 * Generates SEO sitemaps for all Exchange providers.
 *
 * Reads:   data/<source>/exchange-import.json (one per source directory)
 * Writes:  public/sitemap-providers.xml      (one <url> per provider)
 *          public/sitemap-index.xml          (index referencing both sitemaps)
 *          public/robots.txt                 (updated to point at sitemap-index.xml)
 *
 * Usage:   node scripts/generate-provider-sitemap.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isThinListing } from './lib/thin-listing.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const SITE_URL = 'https://dolifetoday.com';

const SOURCES = ['rock-steady', 'lsvt', 'apda', 'parkinsons-uk', 'mds', 'parkinsons-foundation', 'pmd-alliance', 'parkinson-canada', 'products'];

function loadProviders() {
  const all = [];
  const seen = new Set();
  let thinTotal = 0;
  for (const src of SOURCES) {
    const path = join(DATA_DIR, src, 'exchange-import.json');
    if (!existsSync(path)) continue;
    let rows;
    try {
      rows = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      console.warn(`  ! Skipping ${src}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(rows)) continue;
    let added = 0;
    let thin = 0;
    for (const row of rows) {
      const slug = row?.slug?.trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      // Thin listings are prerendered with `noindex, follow` (see
      // scripts/prerender-providers.mjs) so we must also omit them from
      // the sitemap. Otherwise Google keeps rediscovering, crawling, and
      // re-flagging them as Soft 404 (GSC 2026-07-09 report).
      if (isThinListing(row)) {
        thin++;
        thinTotal++;
        continue;
      }
      all.push({
        slug,
        lastmod: (row.scrapedAt || '').slice(0, 10) || undefined,
      });
      added++;
    }
    console.log(`  + ${src}: ${added} providers (skipped ${thin} thin)`);
  }
  console.log(`  = ${all.length} indexable providers (${thinTotal} thin listings omitted from sitemap)`);
  return all;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function buildProviderSitemap(providers) {
  const urls = providers.map((p) => {
    const loc = `${SITE_URL}/exchange/provider/${encodeURIComponent(p.slug)}`;
    const lastmod = p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod}\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function buildSitemapIndex() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_URL}/sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${SITE_URL}/sitemap-providers.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>
`;
}

function buildRobots() {
  return `User-agent: *
Allow: /
Disallow: /inner-circle-lounge
Disallow: /inner-circle-lounge.html

Sitemap: ${SITE_URL}/sitemap-index.xml
`;
}

function main() {
  console.log('Loading provider data...');
  const providers = loadProviders();
  console.log(`Total unique providers: ${providers.length}`);

  if (providers.length > 50000) {
    console.warn('WARNING: Sitemap has >50,000 URLs. Split into multiple files.');
  }

  const providerSitemap = buildProviderSitemap(providers);
  const indexXml = buildSitemapIndex();
  const robots = buildRobots();

  writeFileSync(join(PUBLIC_DIR, 'sitemap-providers.xml'), providerSitemap, 'utf8');
  writeFileSync(join(PUBLIC_DIR, 'sitemap-index.xml'), indexXml, 'utf8');
  writeFileSync(join(PUBLIC_DIR, 'robots.txt'), robots, 'utf8');

  console.log('\nWrote:');
  console.log(`  public/sitemap-providers.xml  (${providers.length} URLs)`);
  console.log(`  public/sitemap-index.xml`);
  console.log(`  public/robots.txt`);
  console.log('\nNext: firebase deploy --only hosting');
  console.log('Then in Search Console → Sitemaps, submit:  sitemap-index.xml');
}

main();
