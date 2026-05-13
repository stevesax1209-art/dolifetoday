#!/usr/bin/env node
/**
 * Pre-renders static HTML for every Exchange provider page so Google
 * (and other crawlers) can index real content instead of "Loading provider..."
 *
 * Reads:   public/exchange-provider.html      (template)
 *          data/<source>/exchange-import.json (provider data)
 *
 * Writes:  public/exchange/provider/<slug>.html
 *          public/exchange/provider/_INDEX.json (debug summary; gitignored)
 *
 * The existing /js/exchange-provider.js still runs on the prerendered
 * pages and hydrates with live API data — the prerender is purely for
 * SEO and first-paint performance.
 *
 * Usage:   node scripts/prerender-providers.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const TEMPLATE_PATH = join(PUBLIC_DIR, 'exchange-provider.html');
const OUT_DIR = join(PUBLIC_DIR, 'exchange', 'provider');
const SITE_URL = 'https://dolifetoday.com';

const SOURCES = [
  { dir: 'rock-steady', label: 'Rock Steady Boxing' },
  { dir: 'lsvt', label: 'LSVT Global', stripPersonalContact: true },
  { dir: 'apda', label: 'APDA' },
  { dir: 'parkinsons-uk', label: "Parkinson's UK" },
  { dir: 'mds', label: 'Movement Disorder Specialists' },
  { dir: 'parkinsons-foundation', label: "Parkinson's Foundation" },
  { dir: 'pmd-alliance', label: 'PMD Alliance' },
  { dir: 'parkinson-canada', label: 'Parkinson Canada CareFinder' },
  { dir: 'products', label: "Parkinson's Products" },
];

// Phrases scraped from internal-review notes that must NOT appear publicly.
const REVIEW_NOTE_PATTERNS = [
  /\s*This record should be reviewed before public publication[^.]*\.?/gi,
  /\s*Review before publication[^.]*\.?/gi,
];

function sanitizeDescription(text) {
  if (!text) return text;
  let out = String(text);
  for (const re of REVIEW_NOTE_PATTERNS) out = out.replace(re, '');
  return out.replace(/\s+/g, ' ').trim();
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escJson(obj) {
  // Escape </script> for safety when embedding JSON-LD inline
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function loadProviders() {
  const map = new Map();
  for (const src of SOURCES) {
    const path = join(DATA_DIR, src.dir, 'exchange-import.json');
    if (!existsSync(path)) continue;
    const list = JSON.parse(readFileSync(path, 'utf8'));
    for (const p of list) {
      if (!p?.slug) continue;
      if (map.has(p.slug)) continue;
      const cleaned = { ...p, _sourceLabel: src.label };
      cleaned.description = sanitizeDescription(cleaned.description);
      cleaned.excerpt = sanitizeDescription(cleaned.excerpt);
      if (src.stripPersonalContact) {
        cleaned.email = '';
        cleaned.phone = '';
      }
      map.set(p.slug, cleaned);
    }
  }
  return [...map.values()];
}

function buildJsonLd(p, listingUrl) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: p.name || p.organizationName || 'Parkinson\'s Provider',
    description: p.description || p.excerpt || `${p.typeLabel || 'Parkinson\'s provider'} listed on The Exchange by Doing Life Today.`,
    url: listingUrl,
    isPartOf: { '@type': 'WebSite', name: 'Doing Life Today', url: SITE_URL },
  };
  if (p.website) ld.sameAs = [p.website];
  if (p.phone) ld.telephone = p.phone;
  if (p.email) ld.email = p.email;
  const addr = {};
  if (p.sourceLocation) addr.streetAddress = p.sourceLocation;
  if (p.city) addr.addressLocality = p.city;
  if (p.stateProvince) addr.addressRegion = p.stateProvince;
  if (p.postcode) addr.postalCode = p.postcode;
  if (p.country) addr.addressCountry = p.country;
  if (Object.keys(addr).length) ld.address = { '@type': 'PostalAddress', ...addr };
  if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
    ld.geo = { '@type': 'GeoCoordinates', latitude: p.latitude, longitude: p.longitude };
  }
  if (p.rating > 0 && p.reviewCount > 0) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: p.rating,
      reviewCount: p.reviewCount,
    };
  }
  return ld;
}

function buildPrerenderedHero(p) {
  const name = escHtml(p.name || p.organizationName || 'Parkinson\'s Provider');
  const subtitle = escHtml([p.typeLabel, p.locationLabel || p.location].filter(Boolean).join(' · '));
  const description = escHtml(p.description || p.excerpt || '');
  const specialties = (p.specialties || []).slice(0, 8).map((s) => `<span class="badge">${escHtml(s)}</span>`).join(' ');
  const contactBits = [];
  if (p.website) contactBits.push(`<li><strong>Website:</strong> <a href="${escHtml(p.website)}" rel="noopener nofollow" target="_blank">${escHtml(p.website)}</a></li>`);
  if (p.phone) contactBits.push(`<li><strong>Phone:</strong> ${escHtml(p.phone)}</li>`);
  if (p.email) contactBits.push(`<li><strong>Email:</strong> ${escHtml(p.email)}</li>`);
  if (p.sourceLocation) contactBits.push(`<li><strong>Address:</strong> ${escHtml(p.sourceLocation)}</li>`);

  // Pre-fill the slug into the claim URL so users skip re-searching.
  const claimUrl = `/claim-listing?provider=${encodeURIComponent(p.slug)}`;

  return `<!-- prerendered SEO content; visible until JS hydration completes -->
<style>
  .exchange-prerendered-seo { padding: 32px 0; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  .exchange-prerendered-seo h1 { margin: 0 0 8px; font-size: 1.875rem; line-height: 1.2; }
  .exchange-prerendered-seo .lede { color: #475569; font-size: 1rem; margin: 0 0 16px; }
  .exchange-prerendered-seo p { margin: 0 0 12px; }
  .exchange-prerendered-seo .badge { display: inline-block; padding: 2px 10px; margin: 2px; background: #e0f2fe; color: #0369a1; border-radius: 9999px; font-size: 0.8rem; }
  .exchange-prerendered-seo .exchange-prerendered-contact { list-style: none; padding: 0; margin: 16px 0; font-size: 0.95rem; }
  .exchange-prerendered-seo .exchange-prerendered-contact li { margin: 4px 0; }
  .exchange-prerendered-seo .exchange-prerendered-cta { margin-top: 20px; }
  .exchange-prerendered-seo .exchange-prerendered-cta .btn { margin-right: 8px; }
  /* Hide once JS hydration reveals the dynamic content card */
  body:has(#exchange-provider-content:not([hidden])) .exchange-prerendered-seo { display: none; }
</style>
<section class="exchange-prerendered-seo" aria-label="Provider summary">
  <div class="container">
    <h1>${name}</h1>
    ${subtitle ? `<p class="lede">${subtitle}</p>` : ''}
    ${description ? `<p>${description}</p>` : ''}
    ${specialties ? `<p class="exchange-prerendered-specialties">${specialties}</p>` : ''}
    ${contactBits.length ? `<ul class="exchange-prerendered-contact">${contactBits.join('')}</ul>` : ''}
    <p class="exchange-prerendered-owner-banner" style="margin:20px 0 8px;padding:12px 16px;background:#fef3c7;border-left:4px solid #d97706;border-radius:6px;color:#78350f;font-size:0.95rem;">
      <strong>Are you the owner?</strong> This listing is unclaimed.
      <a href="${escHtml(claimUrl)}" style="color:#78350f;text-decoration:underline;font-weight:600;">Claim it free in 2 minutes →</a>
    </p>
    <p class="exchange-prerendered-cta">
      <a href="${escHtml(claimUrl)}" class="btn btn-primary">Claim This Listing</a>
      <a href="/exchange" class="btn btn-outline-primary">Browse The Exchange</a>
    </p>
  </div>
</section>`;
}

function renderProvider(template, p) {
  const listingUrl = `${SITE_URL}/exchange/provider/${encodeURIComponent(p.slug)}`;
  const where = [p.city, p.stateProvince].filter(Boolean).join(', ') || p.location || '';
  const titleBase = p.name || p.organizationName || 'Parkinson\'s Provider';
  const title = `${titleBase}${where ? ` — ${where}` : ''} | The Exchange | Doing Life Today`;
  const desc = (p.description || p.excerpt || `${p.typeLabel || 'Parkinson\'s provider'} listed on The Exchange — programs, services, and community insights.`).slice(0, 300);
  const ogTitle = `${titleBase}${where ? ` — ${where}` : ''}`;
  const jsonLd = escJson(buildJsonLd(p, listingUrl));
  const prerenderedHero = buildPrerenderedHero(p);

  let html = template;

  // <title>
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`);

  // description
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escHtml(desc)}">`,
  );

  // canonical
  html = html.replace(
    /<link rel="canonical" href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${escHtml(listingUrl)}" />`,
  );

  // OG title / description / url
  html = html.replace(
    /<meta property="og:title" content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escHtml(ogTitle)}" />`,
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escHtml(desc)}" />`,
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${escHtml(listingUrl)}" />`,
  );

  // JSON-LD
  html = html.replace(
    /<script type="application\/ld\+json" id="provider-jsonld">[\s\S]*?<\/script>/,
    `<script type="application/ld+json" id="provider-jsonld">${jsonLd}</script>`,
  );

  // Inject prerendered hero just inside <main id="main-content">
  html = html.replace(
    /<main id="main-content">/,
    `<main id="main-content">\n${prerenderedHero}`,
  );

  return html;
}

function main() {
  if (!existsSync(TEMPLATE_PATH)) {
    console.error(`Template missing: ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const providers = loadProviders();
  console.log(`Prerendering ${providers.length} providers...`);

  // Clean output dir
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let skipped = 0;
  const summary = [];
  const MAX_SLUG_LEN = 180; // keep filename well under MAX_PATH on Windows
  for (const p of providers) {
    if (p.slug.length > MAX_SLUG_LEN) {
      skipped++;
      continue;
    }
    const html = renderProvider(template, p);
    const file = join(OUT_DIR, `${p.slug}.html`);
    writeFileSync(file, html, 'utf8');
    summary.push({ slug: p.slug, name: p.name, source: p._sourceLabel });
    written++;
    if (written % 1000 === 0) console.log(`  ${written}/${providers.length}`);
  }

  writeFileSync(
    join(OUT_DIR, '_INDEX.json'),
    JSON.stringify({ count: written, skipped, generatedAt: new Date().toISOString(), providers: summary }, null, 2),
    'utf8',
  );

  console.log(`\nDone. Wrote ${written} files to public/exchange/provider/`);
  if (skipped) console.log(`Skipped ${skipped} providers with slugs > ${MAX_SLUG_LEN} chars (served dynamically by /exchange-provider.html rewrite).`);
}

main();
