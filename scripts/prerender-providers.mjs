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

import { isThinListing } from './lib/thin-listing.mjs';

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

// ISO 3166-1 alpha-2 codes for the countries present in our provider data.
// Google Rich Results / Schema.org prefer ISO codes over long-form country
// names; long forms still validate but degrade the LocalBusiness rating in
// Search Console (2026-06-30 SEO audit).
const COUNTRY_ISO = {
  'united states': 'US',
  'united states of america': 'US',
  'usa': 'US',
  'us': 'US',
  'canada': 'CA',
  'united kingdom': 'GB',
  'united kingdom of great britain and northern ireland': 'GB',
  'england': 'GB',
  'scotland': 'GB',
  'wales': 'GB',
  'northern ireland': 'GB',
  'ireland': 'IE',
  'netherlands': 'NL',
  'germany': 'DE',
  'france': 'FR',
  'italy': 'IT',
  'spain': 'ES',
  'portugal': 'PT',
  'switzerland': 'CH',
  'austria': 'AT',
  'belgium': 'BE',
  'luxembourg': 'LU',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'iceland': 'IS',
  'poland': 'PL',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'slovakia': 'SK',
  'hungary': 'HU',
  'romania': 'RO',
  'bulgaria': 'BG',
  'greece': 'GR',
  'ukraine': 'UA',
  'russia': 'RU',
  'russian federation': 'RU',
  'serbia': 'RS',
  'croatia': 'HR',
  'slovenia': 'SI',
  'armenia': 'AM',
  'turkey': 'TR',
  'israel': 'IL',
  'united arab emirates': 'AE',
  'qatar': 'QA',
  'saudi arabia': 'SA',
  'egypt': 'EG',
  'tunisia': 'TN',
  'south africa': 'ZA',
  'nigeria': 'NG',
  'ethiopia': 'ET',
  'zimbabwe': 'ZW',
  'india': 'IN',
  'pakistan': 'PK',
  'bangladesh': 'BD',
  'sri lanka': 'LK',
  'japan': 'JP',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'china': 'CN',
  'republic of china': 'TW', // MDS data uses "Republic of China" for Taiwan
  'taiwan': 'TW',
  'hong kong': 'HK',
  'singapore': 'SG',
  'malaysia': 'MY',
  'indonesia': 'ID',
  'philippines': 'PH',
  'thailand': 'TH',
  'vietnam': 'VN',
  'viet nam': 'VN',
  'australia': 'AU',
  'new zealand': 'NZ',
  'mexico': 'MX',
  'guatemala': 'GT',
  'dominican republic': 'DO',
  'puerto rico': 'PR',
  'brazil': 'BR',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'peru': 'PE',
  'ecuador': 'EC',
  'bolivia': 'BO',
  'uruguay': 'UY',
  'iran, islamic republic of': 'IR',
  'iran': 'IR',
};

function toIsoCountry(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // Already an ISO code (2 uppercase letters)?
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const key = trimmed.toLowerCase();
  return COUNTRY_ISO[key] || null;
}

// Map provider typeLabel / source to the most specific Schema.org type
// Google recognizes for that vertical. Falls back to LocalBusiness.
// A `medicalSpecialty` field is emitted for MedicalBusiness variants so
// Google understands the clinician's focus area.
function resolveSchemaType(p) {
  const t = String(p.typeLabel || p.shortTypeLabel || '').toLowerCase();
  const src = String(p._sourceLabel || '').toLowerCase();

  if (src.includes('rock steady') || t.includes('boxing')) {
    return { type: 'ExerciseGym' };
  }
  if (src.includes('products')) {
    return { type: 'Store' };
  }
  if (t.includes('support group') || t.includes('care partner support') || t.includes('community program') || t.includes('community partners')) {
    return { type: 'Organization' };
  }
  if (t.includes('speech') || t.includes('slp') || t.includes('language pathologist')) {
    return { type: 'MedicalBusiness', medicalSpecialty: 'SpeechPathology' };
  }
  if (t.includes('physical therapy') || t.includes('physiotherap') || t === 'pt' || t.includes('rehab professional') || t.includes('parkinson\u2019s rehabilitation') || t.includes("parkinson's rehabilitation")) {
    return { type: 'Physiotherapy' };
  }
  if (t.includes('occupational therapy') || t === 'ot') {
    return { type: 'MedicalBusiness', medicalSpecialty: 'OccupationalTherapy' };
  }
  if (t.includes('neurologist') || t.includes('movement disorder') || t.includes('center of excellence')) {
    return { type: 'MedicalClinic', medicalSpecialty: 'Neurologic' };
  }
  if (t.includes('genetic counsel')) {
    return { type: 'MedicalBusiness', medicalSpecialty: 'MedicalGenetic' };
  }
  if (t.includes('counsel') || t.includes('psycholog')) {
    return { type: 'MedicalBusiness', medicalSpecialty: 'Psychiatric' };
  }
  if (t.includes('in-home care') || t.includes('home care') || t.includes('daily living')) {
    return { type: 'MedicalBusiness', medicalSpecialty: 'Nursing' };
  }
  if (t.includes('healthcare location') || t.includes('referral center')) {
    return { type: 'MedicalClinic' };
  }
  if (t.includes('exercise') || t.includes('dance') || t.includes('fitness') || t.includes('gym')) {
    return { type: 'ExerciseGym' };
  }
  if (t.includes('parkinson canada resource')) {
    return { type: 'Organization' };
  }
  return { type: 'LocalBusiness' };
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
  const schema = resolveSchemaType(p);
  const ld = {
    '@context': 'https://schema.org',
    '@type': schema.type,
    name: p.name || p.organizationName || 'Parkinson\'s Provider',
    description: p.description || p.excerpt || `${p.typeLabel || 'Parkinson\'s provider'} listed on The Exchange by Doing Life Today.`,
    url: listingUrl,
    isPartOf: { '@type': 'WebSite', name: 'Doing Life Today', url: SITE_URL },
  };
  if (schema.medicalSpecialty) ld.medicalSpecialty = schema.medicalSpecialty;
  if (p.website) ld.sameAs = [p.website];
  if (p.phone) ld.telephone = p.phone;
  if (p.email) ld.email = p.email;

  // Address handling — LSVT data (see 2026-06-30 SEO audit) stores the
  // SEARCH-ORIGIN city (e.g. "Chicago, IL") in `sourceLocation`, NOT the
  // clinician's actual address. Using it as streetAddress causes systemic
  // schema mismatches (H1 says Menomonee Falls, JSON-LD says Chicago) and
  // hurts local ranking. So only trust `sourceLocation` as a street when
  // it isn't LSVT. For every source, fall back to `locationLabel`/`location`
  // as `addressLocality` when `city` is missing.
  const isLsvt = String(p._sourceLabel || '') === 'LSVT Global';
  const addr = {};
  if (p.sourceLocation && !isLsvt) addr.streetAddress = p.sourceLocation;
  if (p.city) {
    addr.addressLocality = p.city;
  } else if (p.locationLabel || p.location) {
    // Strip a trailing ", <country>" if it's redundant with addressCountry.
    const raw = String(p.locationLabel || p.location);
    const cleaned = raw.replace(/,\s*(united states|canada|united kingdom|australia)\s*$/i, '').trim();
    if (cleaned) addr.addressLocality = cleaned;
  }
  if (p.stateProvince) addr.addressRegion = p.stateProvince;
  if (p.postcode) addr.postalCode = p.postcode;
  if (p.country) addr.addressCountry = toIsoCountry(p.country) || p.country;
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
  // LSVT `sourceLocation` is the search-origin city, not the clinician's
  // address — surfacing it in the prerendered contact block would mislead
  // both members and Google. Prefer the real location label instead.
  const isLsvt = String(p._sourceLabel || '') === 'LSVT Global';
  const addressLine = isLsvt
    ? (p.locationLabel || p.location || '')
    : (p.sourceLocation || p.locationLabel || p.location || '');
  if (addressLine) contactBits.push(`<li><strong>Address:</strong> ${escHtml(addressLine)}</li>`);

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

function renderProvider(template, p, { thin = false } = {}) {
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

  // Robots meta — thin (unclaimed, no website, no reviews, no substantive
  // description) listings get `noindex, follow` so Google stops flagging
  // them as Soft 404 while still crawling internal links to richer pages.
  // Substantive / claimed listings inherit the default (indexable).
  if (thin) {
    const robotsTag = '<meta name="robots" content="noindex, follow">';
    if (/<meta name="robots"[^>]*>/i.test(html)) {
      html = html.replace(/<meta name="robots"[^>]*>/i, robotsTag);
    } else {
      html = html.replace(/<\/title>/i, `</title>\n  ${robotsTag}`);
    }
  }

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
  let thinCount = 0;
  const summary = [];
  const MAX_SLUG_LEN = 180; // keep filename well under MAX_PATH on Windows
  for (const p of providers) {
    if (p.slug.length > MAX_SLUG_LEN) {
      skipped++;
      continue;
    }
    const thin = isThinListing(p);
    if (thin) thinCount++;
    const html = renderProvider(template, p, { thin });
    const file = join(OUT_DIR, `${p.slug}.html`);
    writeFileSync(file, html, 'utf8');
    summary.push({ slug: p.slug, name: p.name, source: p._sourceLabel, thin });
    written++;
    if (written % 1000 === 0) console.log(`  ${written}/${providers.length}`);
  }

  writeFileSync(
    join(OUT_DIR, '_INDEX.json'),
    JSON.stringify({ count: written, skipped, thin: thinCount, generatedAt: new Date().toISOString(), providers: summary }, null, 2),
    'utf8',
  );

  console.log(`\nDone. Wrote ${written} files to public/exchange/provider/`);
  console.log(`  • ${thinCount} rendered with noindex,follow (thin listings)`);
  console.log(`  • ${written - thinCount} indexable`);
  if (skipped) console.log(`Skipped ${skipped} providers with slugs > ${MAX_SLUG_LEN} chars (served dynamically by /exchange-provider.html rewrite).`);
}

main();
