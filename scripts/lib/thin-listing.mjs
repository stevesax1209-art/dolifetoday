// Shared classifier for "thin" Exchange provider listings.
//
// A listing is "thin" when it has no unique substance for Google: no
// website, no reviews/rating, no meaningful specialties, and only scraped
// templated copy for a description. Pages like these render as ~4 lines
// of near-duplicate boilerplate across thousands of URLs and get flagged
// as Soft 404 in Google Search Console (see GSC 2026-07-09: 398 URLs
// under /exchange/provider/ flagged).
//
// Thin listings are:
//   - excluded from sitemap-providers.xml
//   - prerendered with <meta name="robots" content="noindex, follow">
//
// The moment a provider claims the listing, adds a website, adds a
// substantive description, or receives a review, the classifier flips
// and the listing becomes indexable on the next deploy. Nothing here is
// destructive — it only gates SEO exposure.

const REVIEW_NOTE_PATTERNS = [
  /this record should be reviewed[^.]*\.?/gi,
  /review before publication[^.]*\.?/gi,
];

function sanitize(desc) {
  let out = String(desc || '');
  for (const re of REVIEW_NOTE_PATTERNS) out = out.replace(re, '');
  return out.replace(/\s+/g, ' ').trim();
}

// Specialty labels that repeat across huge batches of scraped listings
// and therefore add no unique signal.
const GENERIC_SPECIALTIES = new Set([
  "parkinson's care",
  'parkinsons care',
  'community program',
  'lsvt big',
  'lsvt loud',
  'physical therapy',
  'occupational therapy',
  'speech therapy',
]);

function meaningfulSpecialtyCount(specialties) {
  if (!Array.isArray(specialties)) return 0;
  let n = 0;
  for (const s of specialties) {
    const k = String(s || '').toLowerCase().trim();
    if (!k) continue;
    if (GENERIC_SPECIALTIES.has(k)) continue;
    n++;
  }
  return n;
}

// Hand-written copy tends to run >240 chars. Templated scrapes cluster
// around 100–200. The threshold is deliberately generous — false positives
// (indexing a slightly-thin page) are much cheaper than false negatives
// (leaving a Soft 404 in the index).
const SUBSTANTIVE_DESC_MIN = 240;

export function isThinListing(p) {
  if (!p) return true;

  // Claimed / provider-owned listings are always indexable — a human has
  // curated them.
  const status = String(p.listingStatus || '').toLowerCase();
  if (status === 'claimed' || p.claimedAt) return false;

  const hasWebsite = typeof p.website === 'string' && p.website.trim().length > 0;
  if (hasWebsite) return false;

  const hasReviews = Number(p.reviewCount || 0) > 0 || Number(p.rating || 0) > 0;
  if (hasReviews) return false;

  if (meaningfulSpecialtyCount(p.specialties) > 0) return false;

  const description = sanitize(p.description);
  if (description.length >= SUBSTANTIVE_DESC_MIN) return false;

  const excerpt = sanitize(p.excerpt);
  if (excerpt.length >= SUBSTANTIVE_DESC_MIN) return false;

  return true;
}
