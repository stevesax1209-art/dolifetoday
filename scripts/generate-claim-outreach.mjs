#!/usr/bin/env node
/**
 * Generates a personalized "claim your listing" outreach CSV for providers
 * with public email addresses on file.
 *
 * Reads:   data/<source>/exchange-import.json
 * Writes:  data/_outreach/claim-emails.csv  (gitignored — contains contact info)
 *          data/_outreach/SUMMARY.md
 *
 * CSV columns: email, name, organization, city, state, country, source,
 *              listing_url, subject, body
 *
 * Usage:   node scripts/generate-claim-outreach.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(DATA_DIR, '_outreach');
const SITE_URL = 'https://dolifetoday.com';

const SOURCES = [
  { dir: 'rock-steady', label: 'Rock Steady Boxing' },
  { dir: 'lsvt', label: 'LSVT Global' },
  { dir: 'apda', label: 'APDA' },
  { dir: 'parkinsons-uk', label: "Parkinson's UK" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function csvEscape(s) {
  if (s == null) return '';
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildSubject(p) {
  const where = p.city && p.stateProvince ? `${p.city}, ${p.stateProvince}` : p.location || '';
  return `Your ${p.typeLabel || 'program'} listing on Doing Life Today${where ? ` (${where})` : ''}`;
}

function buildBody(p, listingUrl) {
  const greeting = p.organizationName ? `Hi ${p.organizationName} team,` : 'Hello,';
  const where = p.city && p.stateProvince ? `${p.city}, ${p.stateProvince}` : p.location || 'your area';
  const sourceLabel = p._sourceLabel;

  return `${greeting}

We discovered your listing through the ${sourceLabel} directory and added it to The Exchange — a free Parkinson's provider directory by Doing Life Today that helps people with Parkinson's and their care partners find programs near them.

Your listing is live here:
${listingUrl}

Right now it's marked as "unclaimed." Claiming takes about 2 minutes and lets you:
  • Edit your description, hours, and contact info
  • Add photos and program details
  • Respond to reviews and questions from the community
  • See who's viewed your listing
  • Get featured in our weekly resource newsletter

Claim your listing free:
${SITE_URL}/claim-listing

If you'd rather not be listed, just reply to this email and we'll remove it.

Thanks for the work you do for the Parkinson's community in ${where}.

— The Doing Life Today team
${SITE_URL}
`;
}

function loadAll() {
  const rows = [];
  for (const src of SOURCES) {
    const path = join(DATA_DIR, src.dir, 'exchange-import.json');
    if (!existsSync(path)) continue;
    const list = JSON.parse(readFileSync(path, 'utf8'));
    for (const p of list) {
      const email = (p.email || '').trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) continue;
      if ((p.listingStatus || '').toLowerCase() === 'claimed') continue;
      rows.push({ ...p, email, _sourceLabel: src.label });
    }
  }
  return rows;
}

function dedupeByEmail(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.email)) map.set(r.email, r);
  }
  return [...map.values()];
}

function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const all = loadAll();
  const unique = dedupeByEmail(all);

  const header = ['email', 'name', 'organization', 'city', 'state', 'country', 'source', 'listing_url', 'subject', 'body'];
  const lines = [header.join(',')];

  for (const p of unique) {
    const listingUrl = `${SITE_URL}/exchange/provider/${encodeURIComponent(p.slug)}`;
    const subject = buildSubject(p);
    const body = buildBody(p, listingUrl);
    lines.push([
      p.email,
      p.name || '',
      p.organizationName || '',
      p.city || '',
      p.stateProvince || '',
      p.country || '',
      p._sourceLabel,
      listingUrl,
      subject,
      body,
    ].map(csvEscape).join(','));
  }

  const csvPath = join(OUT_DIR, 'claim-emails.csv');
  writeFileSync(csvPath, lines.join('\n'), 'utf8');

  // Per-source summary
  const bySource = {};
  for (const r of unique) bySource[r._sourceLabel] = (bySource[r._sourceLabel] || 0) + 1;

  const summary = `# Claim Outreach List — Generated ${new Date().toISOString().slice(0, 10)}

Total unique provider emails: **${unique.length}**
Total raw matches (with dupes): ${all.length}

## By source
${Object.entries(bySource).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Files
- \`claim-emails.csv\` — one row per unique email, with personalized subject + body

## Suggested send strategy
1. **Pilot batch (50–100):** start with one source (e.g. Rock Steady) so you can iterate copy.
2. Send via your normal email tool (MailerLite, Mailgun, Gmail mail merge, etc.) — DO NOT bulk-send from a personal Gmail account; use a transactional provider with proper SPF/DKIM/DMARC on dolifetoday.com.
3. Track opens / claim conversions in Search Console → Performance, and your Firebase analytics events for \`claim_listing_clicked\`.
4. Add an unsubscribe link before sending at scale (CAN-SPAM / GDPR).

## DO NOT commit this file
The \`data/_outreach/\` directory is gitignored. Provider contact info should stay local.
`;

  writeFileSync(join(OUT_DIR, 'SUMMARY.md'), summary, 'utf8');

  console.log(`\nGenerated ${unique.length} unique outreach rows`);
  console.log(`  ${csvPath}`);
  console.log(`  ${join(OUT_DIR, 'SUMMARY.md')}`);
  console.log('\nBy source:');
  for (const [k, v] of Object.entries(bySource)) console.log(`  ${k}: ${v}`);
}

main();
