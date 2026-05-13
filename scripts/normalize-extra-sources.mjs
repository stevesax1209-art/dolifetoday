#!/usr/bin/env node
/**
 * Normalizes raw scraped data from MDS, Parkinson's Foundation, PMD Alliance,
 * and Parkinson Canada into the standard `exchange-import.json` shape used by
 * the prerender + sitemap pipeline.
 *
 * Usage: node scripts/normalize-extra-sources.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&hellip;|&#8230;/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBase(source, sourceId, name) {
  return {
    sourceSystem: source,
    sourceDirectory: source,
    sourceId,
    slug: '',
    name: name || '',
    typeLabel: '',
    excerpt: '',
    description: '',
    location: '',
    locationLabel: '',
    country: '',
    specialties: [],
    languages: [],
    formats: [],
    verified: false,
    listingStatus: 'unclaimed',
    reviewCount: 0,
    rating: 0,
    website: '',
    email: '',
    phone: '',
    organizationName: '',
    credentials: '',
    rawRole: '',
    rawOrganization: '',
    sourceLocation: '',
    city: '',
    stateProvince: '',
    postcode: '',
    sourceUrl: '',
    scrapedAt: new Date().toISOString(),
  };
}

/* ── MDS Specialists ──────────────────────────────────────── */
function normalizeMds(raw) {
  return raw.map((r, i) => {
    const out = buildBase('mds', r.sourceId || `mds-${i}`, r.name);
    out.slug = slugify(`${r.name}-${r.city || ''}-${r.stateProvince || ''}`) || slugify(r.sourceId || `mds-${i}`);
    out.typeLabel = (r.expertise && r.expertise[0]) || 'Movement Disorder Specialist';
    out.organizationName = r.institution || '';
    out.specialties = Array.isArray(r.expertise) ? r.expertise : [];
    out.phone = r.phone || '';
    out.sourceLocation = r.street || '';
    out.city = r.city || '';
    out.stateProvince = r.stateProvince || '';
    out.postcode = r.postalCode || '';
    out.country = r.country || '';
    out.locationLabel = [r.city, r.stateProvince, r.country].filter(Boolean).join(', ');
    out.location = out.locationLabel;
    out.description = `${r.name}${r.institution ? ` at ${r.institution}` : ''} — Movement Disorder Specialist${r.expertise && r.expertise.length ? ` (${r.expertise.join(', ')})` : ''}${r.city ? ` in ${r.city}, ${r.stateProvince}` : ''}.`;
    out.excerpt = out.description.slice(0, 200);
    return out;
  }).filter(p => p.slug && p.name);
}

/* ── Parkinson's Foundation Locations ────────────────────── */
function normalizePf(raw) {
  return raw.map((r, i) => {
    const out = buildBase('parkinsons-foundation', r.sourceId || `pf-${i}`, r.name);
    out.slug = slugify(`${r.name}-${r.city || ''}-${r.stateProvince || ''}`) || slugify(r.sourceId || `pf-${i}`);
    out.typeLabel = r.type || "Parkinson's Foundation";
    out.organizationName = "Parkinson's Foundation";
    out.specialties = Array.isArray(r.professionals) ? r.professionals : [];
    out.phone = r.phone || '';
    out.website = r.website || '';
    out.sourceLocation = r.address || '';
    out.city = r.city || '';
    out.stateProvince = r.stateProvince || '';
    out.postcode = r.postalCode || r.zip || '';
    out.country = r.country === 'US' ? 'United States' : (r.country || 'United States');
    out.locationLabel = [r.city, r.stateProvince, out.country].filter(Boolean).join(', ');
    out.location = out.locationLabel;
    if (typeof r.latitude === 'number') out.latitude = r.latitude;
    if (typeof r.longitude === 'number') out.longitude = r.longitude;
    const descParts = [
      `${r.name} — ${r.type || "Parkinson's Foundation location"}${r.city ? ` in ${r.city}, ${r.stateProvince}` : ''}.`,
      r.note || '',
      out.specialties.length ? `Programs include: ${out.specialties.join(', ')}.` : '',
    ].filter(Boolean);
    out.description = descParts.join(' ');
    out.excerpt = out.description.slice(0, 200);
    return out;
  }).filter(p => p.slug && p.name);
}

/* ── PMD Alliance ────────────────────────────────────────── */
function normalizePmd(raw) {
  return raw.map((r, i) => {
    const out = buildBase('pmd-alliance', `pmd-${i}`, r.name);
    out.slug = r.slug || slugify(r.name) || `pmd-${i}`;
    out.typeLabel = r.category || 'Support Organization';
    out.organizationName = 'PMD Alliance';
    out.specialties = Array.isArray(r.tags) ? r.tags : [];
    out.phone = r.phone || '';
    out.email = r.email || '';
    out.website = r.sourceUrl || '';
    out.sourceUrl = r.sourceUrl || '';
    out.country = r.country || 'United States';
    out.description = stripHtml(r.description) || `${r.name} — PMD Alliance partner.`;
    out.excerpt = out.description.slice(0, 200);
    return out;
  }).filter(p => p.slug && p.name);
}

/* ── Parkinson Canada CareFinder ─────────────────────────── */
function normalizeCarefinder(raw) {
  return raw.map((entry, i) => {
    const out = buildBase('parkinson-canada', `pc-${entry.id || i}`, entry.name);
    out.slug = slugify(`${entry.name}-${entry.fields?.city || ''}-${entry.fields?.province || ''}`)
      || slugify(`pc-${entry.id || i}`);
    const programs = Array.isArray(entry.programs) ? entry.programs.map(t => t.name).filter(Boolean) : [];
    const medical = Array.isArray(entry.medical) ? entry.medical.map(t => t.name).filter(Boolean) : [];
    const allied = Array.isArray(entry.allied) ? entry.allied.map(t => t.name).filter(Boolean) : [];
    out.typeLabel = programs[0] || medical[0] || allied[0] || 'Parkinson Canada Resource';
    out.organizationName = 'Parkinson Canada CareFinder';
    out.specialties = [...new Set([...programs, ...medical, ...allied])].slice(0, 10);
    out.languages = Array.isArray(entry.languages)
      ? entry.languages.map(l => l.name === 'EN' ? 'English' : l.name === 'FR' ? 'French' : l.name).filter(Boolean)
      : [];
    const f = entry.fields || {};
    out.phone = f.phone_number || '';
    out.email = (f.email && f.email.includes('@')) ? f.email : '';
    out.website = f.website ? (f.website.startsWith('http') ? f.website : `https://${f.website}`) : '';
    out.sourceUrl = entry.link || '';
    out.sourceLocation = [f.address, f.address_line_2].filter(Boolean).join(', ');
    out.city = f.city || '';
    out.stateProvince = f.province || '';
    out.postcode = f.zip_code || '';
    out.country = f.country || 'Canada';
    // CareFinder API has lat/lng swapped at top level — `fields.lng` is actually latitude in their schema.
    // Top-level `lat` value here is longitude; `lng` is latitude. Detect by range.
    const a = parseFloat(entry.lat);
    const b = parseFloat(entry.lng);
    let lat = null, lng = null;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      // Latitude range -90..90. Whichever falls in that range is the latitude.
      if (Math.abs(a) <= 90 && Math.abs(b) > 90) { lat = a; lng = b; }
      else if (Math.abs(b) <= 90 && Math.abs(a) > 90) { lat = b; lng = a; }
      else { lat = a; lng = b; }
    }
    if (lat !== null) out.latitude = lat;
    if (lng !== null) out.longitude = lng;
    out.formats = Array.isArray(f.Care_Delivery) ? f.Care_Delivery : [];
    out.locationLabel = [f.city, f.province, out.country].filter(Boolean).join(', ');
    out.location = out.locationLabel;
    out.description = stripHtml(entry.content) || `${entry.name} — Parkinson Canada CareFinder resource${f.city ? ` in ${f.city}, ${f.province}` : ''}.`;
    out.excerpt = out.description.slice(0, 200);
    return out;
  }).filter(p => p.slug && p.name);
}

/* ── Run ──────────────────────────────────────────────────── */
const tasks = [
  { src: 'mds/specialists.json', dest: 'mds/exchange-import.json', fn: normalizeMds, label: 'MDS specialists' },
  { src: 'parkinsons-foundation/locations.json', dest: 'parkinsons-foundation/exchange-import.json', fn: normalizePf, label: "Parkinson's Foundation" },
  { src: 'pmd-alliance/listings.json', dest: 'pmd-alliance/exchange-import.json', fn: normalizePmd, label: 'PMD Alliance' },
  { src: 'parkinson-canada/care-finder.json', dest: 'parkinson-canada/exchange-import.json', fn: normalizeCarefinder, label: 'Parkinson Canada CareFinder' },
];

let total = 0;
for (const t of tasks) {
  const inPath = join(DATA_DIR, t.src);
  if (!existsSync(inPath)) { console.log(`  - ${t.label}: SKIP (no source)`); continue; }
  const raw = JSON.parse(readFileSync(inPath, 'utf8'));
  const normalized = t.fn(raw);
  writeFileSync(join(DATA_DIR, t.dest), JSON.stringify(normalized, null, 2));
  console.log(`  + ${t.label}: ${normalized.length} entries → ${t.dest}`);
  total += normalized.length;
}
console.log(`\nTotal normalized: ${total}`);
