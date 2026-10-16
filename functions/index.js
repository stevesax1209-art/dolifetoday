'use strict';

/**
 * Firebase Cloud Functions for Doing Life Today
 *
 * Endpoints (rewritten via Firebase Hosting in firebase.json):
 *   GET  /api/public-config  →  publicConfig() — public client config such as reCAPTCHA site key
 *   POST /api/subscribe  →  subscribe()  — newsletter sign-up via MailerLite API v3
 *   POST /api/contact    →  contact()    — contact form: emails via MailerSend + Firestore log
 *   POST /api/mailerlite-webhook → mailerLiteWebhook() — waitlist confirmation sync from MailerLite
 *
 * Environment variables (set in Firebase Console → Functions → Configuration,
 * or via CLI: firebase functions:config:set mailerlite.token="..." etc.):
 *   MAILERLITE_API_TOKEN          — required
 *   MAILERLITE_GROUP_ID                 — optional; newsletter group ID
 *   MAILERLITE_THECLUB_WAITLIST_GROUP_ID — optional; The Club waitlist group ID
 *   RECAPTCHA_SITE_KEY                  — required for frontend rendering
 *   RECAPTCHA_SECRET_KEY                — required for server-side verification
 *   MAILERLITE_WEBHOOK_SECRET           — required to validate MailerLite webhook signatures
 *   MAILERSEND_API_KEY                  — required for /api/contact email delivery
 *   CONTACT_NOTIFY_EMAIL                — optional; override recipient inbox for all contact submissions
 */

const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Cross-project Firestore for pathway-providers (lives in pcn---new)
const pcnApp = admin.apps.find(a => a.name === 'pcn') ||
  admin.initializeApp({ projectId: 'pcn---new' }, 'pcn');
const pcnDb = admin.firestore(pcnApp);

// Cross-project Firestore for The Club (lives in parkinsons-community-821-a4c27)
// Used to write launch-allowlist entries so QR-scan signups from /live
// are auto-approved when they create a Club account.
const clubApp = admin.apps.find(a => a.name === 'club') ||
  admin.initializeApp({ projectId: 'parkinsons-community-821-a4c27' }, 'club');
const clubDb = admin.firestore(clubApp);
const CLUB_LAUNCH_ALLOWLIST_COLLECTION = 'launch-allowlist';

/**
 * Add an email to The Club's launch-allowlist so the user is auto-approved
 * when they create their account at club.dolifetoday.com.
 * Wrapped in try/catch — failure must NOT break the MailerLite signup flow.
 */
async function addToClubLaunchAllowlist({ email, wave, source, addedByUserId }) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) return false;
  try {
    await clubDb.collection(CLUB_LAUNCH_ALLOWLIST_COLLECTION).doc(normalizedEmail).set({
      approved: true,
      email: normalizedEmail,
      normalizedEmail,
      wave: wave || 'wpc-2026-phoenix',
      source: source || 'wpc-2026-phoenix',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
      addedByUserId: addedByUserId || 'dolifetoday-subscribe-fn',
      addedByEmail: 'system@dolifetoday.com',
    }, { merge: true });
    functions.logger.info('Club launch-allowlist entry written', { email: normalizedEmail, source });
    return true;
  } catch (err) {
    functions.logger.error('Failed to write Club launch-allowlist entry', {
      email: normalizedEmail,
      source,
      error: err?.message || String(err),
    });
    return false;
  }
}

const WAITLIST_STATS_COLLECTION = 'site_stats';
const WAITLIST_STATS_DOC_ID = 'club_waitlist';
const SHARE_STATS_DOC_ID = 'club_share_stats';
const CLUB_PAGE_STATS_DOC_ID = 'club_page_stats';
const CHECK_WAVE_STATS_DOC_ID = 'check_wave_stats';
const INNER_CIRCLE_LOUNGE_STATS_DOC_ID = 'inner_circle_lounge_stats';
const LEGACY_WAITLIST_MIGRATION_COUNT = 68;
const WAITLIST_MANUAL_COUNT_ADJUSTMENT = 19;
const RATE_LIMIT_COLLECTION = 'submission_rate_limits';
const REJECTION_LOG_COLLECTION = 'submission_rejections';
const WAITLIST_SOURCE = 'club_waitlist';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_BLOCK_THRESHOLD = 3;
const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WAITLIST_TRACKING_WAVES = Object.freeze([1, 2, 3, 4, 5, 6, 17]);
const EVENT_WAVE_GROUPS = Object.freeze({ 17: '184137771747641308' });
const COMMON_FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

// Disposable/burner email domains — reject provider claims outright to
// cut down on the throwaway-account spam claims (e.g. random @mailinator
// signups on unrelated brand names). Keep this list conservative;
// legitimate providers do not use throwaway inboxes for outreach.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'trashmail.com', 'trashmail.net', 'guerrillamail.com',
  'guerrillamail.info', 'guerrillamail.biz', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'temp-mail.io', 'yopmail.com', 'yopmail.fr', 'discard.email',
  'throwawaymail.com', 'maildrop.cc', 'mintemail.com', 'getnada.com',
  'nada.email', 'mohmal.com', 'dispostable.com', 'spamgourmet.com',
  'fakeinbox.com', 'anonaddy.me', 'burnermail.io', 'mvrht.net',
  'inboxbear.com', 'emailondeck.com', 'moakt.com', 'einrot.com',
  'jetable.org', 'yopmail.net', 'byom.de', 'mytemp.email',
]);

// Loose Parkinson's-relevance keyword set for auto-flagging claims where
// the listed business name gives no signal of PD relevance (e.g. a
// clothing brand claiming a listing that snuck into the index). Not a
// definitive check — only used to surface an "unclear relevance" pill.
const PD_RELEVANCE_KEYWORDS = [
  'parkinson', "parkinsons", 'parkinson\u2019s', 'pd ',
  'movement disorder', 'neurology', 'neurologist', 'neuro ',
  'physical therapy', 'occupational therapy', 'speech therapy',
  'lsvt', 'pwr', 'rock steady', 'boxing for parkinson',
  'dbs', 'deep brain', 'levodopa', 'carbidopa', 'sinemet',
  'tremor', 'dyskinesia', 'dystonia', 'freezing of gait',
  'caregiver', 'care partner', 'support group', 'brain health',
  'aging', 'senior', 'geriatric', 'wellness', 'rehab',
  'physiotherapy', 'balance', 'gait', 'apda', 'michael j fox',
  'davis phinney', 'pmd alliance', 'brian grant', 'yoga',
  'dance for pd', 'tai chi', 'mindful', 'nutrition',
];

function extractEmailDomain(email) {
  if (!email) return '';
  const parts = String(email).trim().toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

function extractWebsiteDomain(url) {
  if (!url) return '';
  return String(url).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0];
}

function domainRootPart(domain) {
  if (!domain) return '';
  const parts = domain.split('.');
  if (parts.length < 2) return domain;
  const secondLevelTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
  if (parts.length >= 3 && secondLevelTlds.has(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts[parts.length - 2];
}

function assessProviderClaim({ email, listedWebsite, providerName, listedType }) {
  const emailDomain = extractEmailDomain(email);
  const siteDomain = extractWebsiteDomain(listedWebsite);
  const isPersonal = emailDomain ? COMMON_FREE_EMAIL_DOMAINS.has(emailDomain) : false;
  const isDisposable = emailDomain ? DISPOSABLE_EMAIL_DOMAINS.has(emailDomain) : false;

  let domainMatch = null;
  if (emailDomain && siteDomain) {
    if (emailDomain === siteDomain ||
        (domainRootPart(emailDomain) && domainRootPart(emailDomain) === domainRootPart(siteDomain))) {
      domainMatch = 'match';
    } else {
      domainMatch = 'mismatch';
    }
  }

  // Auto-verifiable when the claimant's email is on the same domain as the
  // organization's public website AND is not a personal free-mail domain.
  const autoVerified = domainMatch === 'match' && !isPersonal && !isDisposable;

  const haystack = ((providerName || '') + ' ' + (listedType || '')).toLowerCase();
  const pdRelevanceLikely = PD_RELEVANCE_KEYWORDS.some(k => haystack.includes(k));

  return {
    emailDomain,
    siteDomain,
    isPersonalEmail: isPersonal,
    isDisposableEmail: isDisposable,
    domainMatch,
    autoVerified,
    pdRelevanceLikely,
  };
}

const CLUB_ANALYTICS_EVENTS = Object.freeze({
  page_view: 'pageViews',
  form_start: 'formStarts',
  submit_attempt: 'submitAttempts',
  form_error: 'formErrors',
  network_error: 'networkErrors',
});

const DEFAULT_CLUB_PAGE_TOTALS = Object.freeze({
  pageViews: 0,
  formStarts: 0,
  submitAttempts: 0,
  signups: 0,
  duplicateSignups: 0,
  formErrors: 0,
  networkErrors: 0,
});

const DEFAULT_CTA_LOCATIONS = Object.freeze({
  nav: 0,
  mobile: 0,
  hero_form: 0,
  floating: 0,
  section: 0,
  footer: 0,
});

const ROLE_KEY_MAP = Object.freeze({
  "A person living with Parkinson's": 'person_living_with_parkinsons',
  'A care partner / spouse / family caregiver': 'care_partner',
});

const MAILERLITE_API_URL = 'https://connect.mailerlite.com/api/subscribers';
const PODCAST_FEEDS = Object.freeze({
  'living-with-parkinsons': {
    slug: 'living-with-parkinsons',
    rssUrl: 'https://anchor.fm/s/10cda1a08/podcast/rss',
    siteUrl: 'https://podcast.dolifetoday.com/',
    title: "Living with Parkinson's – Bryce Perry",
    description: "Bryce Perry hosts honest conversations about the realities of living with Parkinson's, with practical guidance, expert guests, and community stories.",
    platforms: {
      apple: 'https://podcasts.apple.com/us/podcast/living-with-parkinsons-bryce-perry/id1807175105',
      spotify: 'https://open.spotify.com/show/5x3KjcDBRN4NxFU44TyqEf',
      audible: 'https://www.audible.com/podcast/Living-with-Parkinsons-Bryce-Perry/B0F3N16DWY',
      podchaser: 'https://www.podchaser.com/podcasts/living-with-parkinsons-bryce-p-6056304',
    },
  },
  'life-in-motion': {
    slug: 'life-in-motion',
    rssUrl: 'https://anchor.fm/s/10cda2d90/podcast/rss',
    siteUrl: 'https://lifeinmotion.dolifetoday.com/',
    title: "Life in Motion: The Parkinson's Podcast",
    description: "Bryce Perry and Brian Campkin share practical insights, humor, and lived experience for people navigating Parkinson's every day.",
    platforms: {
      apple: 'https://podcasts.apple.com/us/podcast/life-in-motion-the-parkinsons-podcast/id1831117141',
      spotify: 'https://open.spotify.com/show/4IwNzs1O4qYL5YQtelgsyX',
    },
  },
});

/* ── Helpers ─────────────────────────────────────────────────── */

function parseBody(req) {
  if (typeof req.body === 'object' && req.body !== null) return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function setCorsHeaders(res, methods = 'POST, OPTIONS') {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', methods);
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getRawBodyText(req) {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString('utf8');
  }

  if (typeof req.body === 'string') {
    return req.body;
  }

  if (typeof req.body === 'object' && req.body !== null) {
    return JSON.stringify(req.body);
  }

  return '';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function getEnvValue(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.replace(/[\r\n]+$/g, '') : '';
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const candidate = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0] : req.ip || req.socket?.remoteAddress || 'unknown');

  return String(candidate || 'unknown').trim().replace(/^::ffff:/, '');
}

function countMatches(value, pattern) {
  const matches = String(value || '').match(pattern);
  return matches ? matches.length : 0;
}

function looksLikeUrl(value) {
  return /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|info|biz|xyz|click|link|ru)\b)/i.test(String(value || ''));
}

function looksRandomishToken(value, minLength = 10) {
  const token = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  if (token.length < minLength) {
    return false;
  }

  const digits = countMatches(token, /\d/g);
  const vowels = countMatches(token, /[aeiouy]/g);
  const uniqueRatio = token.length ? (new Set(token).size / token.length) : 0;

  return /(.)\1{4,}/.test(token)
    || /[bcdfghjklmnpqrstvwxyz]{6,}/.test(token)
    || (/^[a-z]+$/.test(token) && vowels === 0 && token.length >= 8)
    || (digits >= 4 && vowels <= 1)
    || (token.length >= 14 && vowels <= 1 && uniqueRatio > 0.7);
}

function isLikelySpamName(value) {
  const name = normalizeText(value);

  if (!name || name.length < 2 || name.length > 80) {
    return true;
  }

  if (looksLikeUrl(name) || countMatches(name, /\d/g) >= 4) {
    return true;
  }

  const lettersOnly = name.replace(/[^a-z]/gi, '');
  if (lettersOnly.length < 2) {
    return true;
  }

  return name.split(/\s+/).some((token) => looksRandomishToken(token, 8));
}

function isLikelyRandomEmail(value) {
  const email = normalizeText(value).toLowerCase();
  const [localPart = '', domain = ''] = email.split('@');

  if (!localPart || !domain) {
    return true;
  }

  const cleanedLocal = localPart.replace(/[._+-]/g, '');

  return localPart.length > 64
    || /(.)\1{5,}/.test(cleanedLocal)
    || (COMMON_FREE_EMAIL_DOMAINS.has(domain) && looksRandomishToken(cleanedLocal, 12))
    || (cleanedLocal.length >= 10 && countMatches(cleanedLocal, /\d/g) >= 7);
}

function isLikelySpamCompany(value) {
  const company = normalizeText(value);

  if (!company) {
    return false;
  }

  return company.length > 120
    || looksLikeUrl(company)
    || /(casino|viagra|cialis|loan|porn|sex|telegram|whatsapp|bit\.ly)/i.test(company)
    || looksRandomishToken(company, 10);
}

async function logRejectedSubmission({ endpoint, ip, reason }) {
  functions.logger.warn('Rejected submission', { endpoint, ip, reason });

  try {
    await db.collection(REJECTION_LOG_COLLECTION).add({
      endpoint,
      ip,
      reason,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    functions.logger.error('Unable to persist rejected submission log:', error);
  }
}

async function rejectSubmission(res, options) {
  const {
    status = 400,
    endpoint,
    ip,
    reason,
    message,
    retryAfterMs,
  } = options;

  await logRejectedSubmission({ endpoint, ip, reason });

  if (retryAfterMs) {
    res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  }

  res.status(status).json({ error: message });
}

function buildRateLimitDocId(endpoint, ip) {
  return createHash('sha256').update(`${endpoint}:${ip}`).digest('hex');
}

async function enforceSubmissionRateLimit(endpoint, ip) {
  const limitRef = db.collection(RATE_LIMIT_COLLECTION).doc(buildRateLimitDocId(endpoint, ip));
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(limitRef);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const blockedUntilMs = Number(data.blockedUntilMs) || 0;
    const lastAttemptAtMs = Number(data.lastAttemptAtMs) || 0;
    const rapidAttempts = Number(data.rapidAttempts) || 0;

    if (blockedUntilMs > now) {
      transaction.set(limitRef, {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        allowed: false,
        blocked: true,
        retryAfterMs: blockedUntilMs - now,
      };
    }

    if (lastAttemptAtMs && (now - lastAttemptAtMs) < RATE_LIMIT_WINDOW_MS) {
      const nextRapidAttempts = rapidAttempts + 1;
      const shouldBlock = nextRapidAttempts >= RATE_LIMIT_BLOCK_THRESHOLD;
      const nextBlockedUntilMs = shouldBlock ? now + RATE_LIMIT_BLOCK_MS : 0;

      transaction.set(limitRef, {
        lastAttemptAtMs: now,
        rapidAttempts: nextRapidAttempts,
        blockedUntilMs: nextBlockedUntilMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        allowed: false,
        blocked: shouldBlock,
        retryAfterMs: shouldBlock ? RATE_LIMIT_BLOCK_MS : (RATE_LIMIT_WINDOW_MS - (now - lastAttemptAtMs)),
      };
    }

    transaction.set(limitRef, {
      lastAttemptAtMs: now,
      rapidAttempts: 0,
      blockedUntilMs: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { allowed: true };
  });
}

async function verifyRecaptchaToken(token, ip) {
  const secret = getEnvValue('RECAPTCHA_SECRET_KEY');

  if (!secret) {
    functions.logger.error('RECAPTCHA_SECRET_KEY is not set.');
    return {
      ok: false,
      reason: 'Spam protection is temporarily unavailable. Please try again later.',
    };
  }

  if (typeof token !== 'string' || !token.trim()) {
    return {
      ok: false,
      reason: 'Please complete the reCAPTCHA verification.',
    };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token.trim(),
    });

    if (ip && ip !== 'unknown') {
      body.set('remoteip', ip);
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      functions.logger.error(`reCAPTCHA upstream error ${response.status}`);
      return {
        ok: false,
        reason: 'Unable to verify reCAPTCHA. Please try again.',
      };
    }

    const payload = await response.json();

    if (!payload.success) {
      functions.logger.warn('reCAPTCHA verification failed', {
        errors: payload['error-codes'] || [],
      });

      return {
        ok: false,
        reason: 'Please complete the reCAPTCHA verification.',
      };
    }

    return { ok: true };
  } catch (error) {
    functions.logger.error('Unable to verify reCAPTCHA:', error);
    return {
      ok: false,
      reason: 'Unable to verify reCAPTCHA. Please try again.',
    };
  }
}

function secretsMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildWaitlistDocId(email) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function getWaitlistStatsRef() {
  return db.collection(WAITLIST_STATS_COLLECTION).doc(WAITLIST_STATS_DOC_ID);
}

async function ensureWaitlistStatsDoc() {
  const statsRef = getWaitlistStatsRef();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(statsRef);

    if (snapshot.exists) {
      return;
    }

    transaction.set(statsRef, {
      legacyCount: LEGACY_WAITLIST_MIGRATION_COUNT,
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      migrationSource: 'hardcoded_baseline',
    });
  });
}

async function upsertWaitlistEntry(email, source) {
  const normalizedEmail = email.trim().toLowerCase();
  const waitlistRef = db.collection('waitlist').doc(buildWaitlistDocId(normalizedEmail));
  const snapshot = await waitlistRef.get();

  if (snapshot.exists) {
    return false;
  }

  await waitlistRef.set({
    email: normalizedEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    source: typeof source === 'string' && source.trim() ? source.trim() : 'club_waitlist',
  });

  return true;
}

async function removeWaitlistEntry(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const waitlistRef = db.collection('waitlist').doc(buildWaitlistDocId(normalizedEmail));
  const snapshot = await waitlistRef.get();

  if (!snapshot.exists) {
    return false;
  }

  await waitlistRef.delete();
  return true;
}

async function getLegacyWaitlistCount() {
  const snapshot = await getWaitlistStatsRef().get();

  if (!snapshot.exists) {
    return 0;
  }

  const legacyCount = Number(snapshot.get('legacyCount'));
  return Number.isFinite(legacyCount) ? Math.max(0, Math.floor(legacyCount)) : 0;
}

function getShareStatsRef() {
  return db.collection(WAITLIST_STATS_COLLECTION).doc(SHARE_STATS_DOC_ID);
}

function getClubPageStatsRef() {
  return db.collection(WAITLIST_STATS_COLLECTION).doc(CLUB_PAGE_STATS_DOC_ID);
}

function getCurrentDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeRoleKey(role) {
  const trimmedRole = typeof role === 'string' ? role.trim() : '';
  return ROLE_KEY_MAP[trimmedRole] || 'other';
}

function getMergedStatMap(data, nestedKey, defaults = {}) {
  const directMap = data[nestedKey] && typeof data[nestedKey] === 'object' ? data[nestedKey] : {};
  const merged = { ...defaults };
  Object.keys(directMap).forEach((key) => {
    merged[key] = Number.isFinite(Number(directMap[key])) ? Number(directMap[key]) : directMap[key];
  });
  const prefix = `${nestedKey}.`;

  Object.keys(data).forEach((key) => {
    if (!key.startsWith(prefix)) {
      return;
    }

    const childKey = key.slice(prefix.length);
    const legacyValue = Number.isFinite(Number(data[key])) ? Number(data[key]) : 0;
    const currentValue = Number.isFinite(Number(merged[childKey])) ? Number(merged[childKey]) : 0;
    merged[childKey] = currentValue + legacyValue;
  });

  return merged;
}

function getCheckWaveStatsRef() {
  return db.collection(WAITLIST_STATS_COLLECTION).doc(CHECK_WAVE_STATS_DOC_ID);
}

async function recordCheckWaveEvent(eventType, details = {}) {
  const ref = getCheckWaveStatsRef();
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  const validEvents = ['lookup', 'found', 'not_found', 'unconfirmed', 'share_copy', 'share_email', 'share_text', 'join_click'];

  if (!validEvents.includes(eventType)) return;

  updates.totals = { [eventType]: admin.firestore.FieldValue.increment(1) };

  if (details.page) {
    updates.pages = { [details.page]: admin.firestore.FieldValue.increment(1) };
  }

  if (details.wave && (eventType === 'found' || eventType === 'unconfirmed')) {
    updates.waveBreakdown = { ['wave_' + details.wave]: admin.firestore.FieldValue.increment(1) };
  }

  await ref.set(updates, { merge: true });
}

async function getCheckWaveStats() {
  const snapshot = await getCheckWaveStatsRef().get();

  if (!snapshot.exists) {
    return { totals: {}, pages: {}, waveBreakdown: {}, updatedAt: null };
  }

  const data = snapshot.data() || {};
  const updatedAt = data.updatedAt && typeof data.updatedAt.toDate === 'function'
    ? data.updatedAt.toDate().toISOString()
    : null;

  return {
    totals: getMergedStatMap(data, 'totals'),
    pages: getMergedStatMap(data, 'pages'),
    waveBreakdown: getMergedStatMap(data, 'waveBreakdown'),
    updatedAt,
  };
}

async function getShareStats() {
  const snapshot = await getShareStatsRef().get();

  if (!snapshot.exists) {
    return {
      total: 0,
      channels: {},
      pages: {},
      updatedAt: null,
    };
  }

  const data = snapshot.data() || {};
  const updatedAt = data.updatedAt && typeof data.updatedAt.toDate === 'function'
    ? data.updatedAt.toDate().toISOString()
    : null;

  return {
    total: Number.isFinite(Number(data.total)) ? Number(data.total) : 0,
    channels: getMergedStatMap(data, 'channels'),
    pages: getMergedStatMap(data, 'pages'),
    updatedAt,
  };
}

async function getClubPageStats() {
  const snapshot = await getClubPageStatsRef().get();

  if (!snapshot.exists) {
    return {
      totals: { ...DEFAULT_CLUB_PAGE_TOTALS },
      ctaClicks: { ...DEFAULT_CTA_LOCATIONS },
      signupRoles: {},
      dailySignups: {},
      trafficSources: {},
      updatedAt: null,
    };
  }

  const data = snapshot.data() || {};
  const updatedAt = data.updatedAt && typeof data.updatedAt.toDate === 'function'
    ? data.updatedAt.toDate().toISOString()
    : null;

  return {
    totals: {
      ...DEFAULT_CLUB_PAGE_TOTALS,
      ...getMergedStatMap(data, 'totals'),
    },
    ctaClicks: getMergedStatMap(data, 'ctaClicks', DEFAULT_CTA_LOCATIONS),
    signupRoles: getMergedStatMap(data, 'signupRoles'),
    dailySignups: getMergedStatMap(data, 'dailySignups'),
    trafficSources: getMergedStatMap(data, 'trafficSources'),
    updatedAt,
  };
}

/* ── Inner Circle Lounge stats ────────────────────────────────
   Tracks visits + unlock success/fail + zoom join clicks + ics
   downloads on the private members lounge at /inner-circle-lounge.
   Fed by /api/track-inner-circle-lounge; read by /api/share-stats. */

const DEFAULT_INNER_CIRCLE_LOUNGE_TOTALS = Object.freeze({
  pageViews: 0,
  unlockSuccess: 0,
  unlockFailure: 0,
  zoomJoinMorning: 0,
  zoomJoinEvening: 0,
  icsDownloads: 0,
});

const INNER_CIRCLE_LOUNGE_EVENTS = Object.freeze({
  page_view: 'pageViews',
  unlock_success: 'unlockSuccess',
  unlock_failure: 'unlockFailure',
  zoom_join_morning: 'zoomJoinMorning',
  zoom_join_evening: 'zoomJoinEvening',
  ics_download: 'icsDownloads',
});

function getInnerCircleLoungeStatsRef() {
  return db.collection(WAITLIST_STATS_COLLECTION).doc(INNER_CIRCLE_LOUNGE_STATS_DOC_ID);
}

async function getInnerCircleLoungeStats() {
  const snapshot = await getInnerCircleLoungeStatsRef().get();
  if (!snapshot.exists) {
    return {
      totals: { ...DEFAULT_INNER_CIRCLE_LOUNGE_TOTALS },
      dailyPageViews: {},
      trafficSources: {},
      updatedAt: null,
    };
  }
  const data = snapshot.data() || {};
  const updatedAt = data.updatedAt && typeof data.updatedAt.toDate === 'function'
    ? data.updatedAt.toDate().toISOString()
    : null;
  return {
    totals: {
      ...DEFAULT_INNER_CIRCLE_LOUNGE_TOTALS,
      ...getMergedStatMap(data, 'totals'),
    },
    dailyPageViews: getMergedStatMap(data, 'dailyPageViews'),
    trafficSources: getMergedStatMap(data, 'trafficSources'),
    updatedAt,
  };
}

async function recordInnerCircleLoungeEvent(eventType, details = {}) {
  const statKey = INNER_CIRCLE_LOUNGE_EVENTS[eventType];
  if (!statKey) throw new Error(`Unsupported inner circle lounge event: ${eventType}`);

  const updates = {
    totals: { [statKey]: admin.firestore.FieldValue.increment(1) },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (eventType === 'page_view') {
    const dateKey = getCurrentDateKey();
    updates.dailyPageViews = { [dateKey]: admin.firestore.FieldValue.increment(1) };
    const source = typeof details.source === 'string' && details.source.trim()
      ? details.source.trim().slice(0, 80) : 'direct';
    updates.trafficSources = { [source]: admin.firestore.FieldValue.increment(1) };
  }

  await getInnerCircleLoungeStatsRef().set(updates, { merge: true });
}

async function recordShareClick(channel, page) {
  const shareStatsRef = getShareStatsRef();
  const normalizedChannel = typeof channel === 'string' && channel.trim() ? channel.trim() : 'unknown';
  const normalizedPage = typeof page === 'string' && page.trim() ? page.trim() : 'theclub';

  await shareStatsRef.set({
    total: admin.firestore.FieldValue.increment(1),
    channels: {
      [normalizedChannel]: admin.firestore.FieldValue.increment(1),
    },
    pages: {
      [normalizedPage]: admin.firestore.FieldValue.increment(1),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function recordClubAnalyticsEvent(eventType, details = {}) {
  const statKey = CLUB_ANALYTICS_EVENTS[eventType];

  if (!statKey) {
    throw new Error(`Unsupported club analytics event: ${eventType}`);
  }

  const updates = {
    totals: {
      [statKey]: admin.firestore.FieldValue.increment(1),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (eventType === 'page_view') {
    const normalizedSource = typeof details.source === 'string' && details.source.trim()
      ? details.source.trim().slice(0, 80)
      : 'direct';
    updates.trafficSources = {
      [normalizedSource]: admin.firestore.FieldValue.increment(1),
    };
  }

  if (details.location) {
    updates.ctaClicks = {
      [details.location]: admin.firestore.FieldValue.increment(1),
    };
  }

  await getClubPageStatsRef().set(updates, { merge: true });
}

async function recordClubCtaClick(location) {
  const normalizedLocation = typeof location === 'string' && location.trim() ? location.trim() : 'section';

  await getClubPageStatsRef().set({
    ctaClicks: {
      [normalizedLocation]: admin.firestore.FieldValue.increment(1),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function recordClubSignupResult(waitlistCounted, audienceRole) {
  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (waitlistCounted) {
    const roleKey = normalizeRoleKey(audienceRole);
    const dateKey = getCurrentDateKey();
    updates.totals = {
      signups: admin.firestore.FieldValue.increment(1),
    };
    updates.signupRoles = {
      [roleKey]: admin.firestore.FieldValue.increment(1),
    };
    updates.dailySignups = {
      [dateKey]: admin.firestore.FieldValue.increment(1),
    };
  } else {
    updates.totals = {
      duplicateSignups: admin.firestore.FieldValue.increment(1),
    };
  }

  await getClubPageStatsRef().set(updates, { merge: true });
}

async function getWaitlistCount() {
  const [snapshot, legacyCount] = await Promise.all([
    db.collection('waitlist').where('source', '==', 'club_waitlist').count().get(),
    getLegacyWaitlistCount(),
  ]);

  return legacyCount + snapshot.data().count + WAITLIST_MANUAL_COUNT_ADJUSTMENT;
}

function computeWave(count) {
  if (count <= 200) return 1;
  if (count <= 400) return 2;
  if (count <= 600) return 3;
  if (count <= 800) return 4;
  if (count <= 1000) return 5;
  return 6;
}

function buildWaitlistWaveTrackingFields(wave) {
  const normalizedWave = Number(wave);

  if (!Number.isInteger(normalizedWave) || normalizedWave < 1) {
    return {};
  }

  const trackingFields = {
    wave: String(normalizedWave),
  };

  WAITLIST_TRACKING_WAVES.forEach((waveNumber) => {
    trackingFields[`wave_${waveNumber}`] = normalizedWave === waveNumber ? 'true' : 'false';
  });

  return trackingFields;
}

function buildWaitlistSubscriberFields({ source, audienceRole, wave }) {
  const fields = {
    source: typeof source === 'string' && source.trim() ? source.trim() : WAITLIST_SOURCE,
    ...buildWaitlistWaveTrackingFields(wave),
  };

  if (audienceRole) {
    fields.audience_role = audienceRole;
  }

  return fields;
}

async function updateMailerLiteSubscriberFields(apiToken, email, fields) {
  await fetch(MAILERLITE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ email, fields }),
  });
}

function getWaitlistGroupId() {
  return getEnvValue('MAILERLITE_THECLUB_WAITLIST_GROUP_ID') || getEnvValue('MAILERLITE_GROUP_ID') || '';
}

function getWebhookSignature(req) {
  const signature = req.get('Signature') || req.get('signature');
  return typeof signature === 'string' ? signature.trim() : '';
}

function verifyWebhookSignature(req, secret) {
  const signature = getWebhookSignature(req);

  if (!signature || !secret) {
    return false;
  }

  const computed = createHmac('sha256', secret)
    .update(getRawBodyText(req), 'utf8')
    .digest('hex');

  return secretsMatch(signature, computed);
}

function extractMailerLiteEventName(payload) {
  return normalizeText(
    payload?.event
    || payload?.event_name
    || payload?.type
    || payload?.name
    || payload?.meta?.event
    || payload?.webhook_event
  );
}

function extractGroupIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((group) => {
      if (typeof group === 'string' || typeof group === 'number') {
        return String(group);
      }

      if (group && typeof group === 'object') {
        return String(group.id || group.group_id || '').trim();
      }

      return '';
    })
    .filter(Boolean);
}

function extractWebhookSubscriber(payload) {
  const candidate = payload?.data?.subscriber
    || payload?.subscriber
    || payload?.data
    || payload
    || {};

  const groupIds = extractGroupIds(
    candidate.groups
    || candidate.group_ids
    || payload?.groups
    || payload?.group_ids
  );

  const normalizedSource = normalizeText(
    candidate?.fields?.source
    || candidate.source
    || payload?.fields?.source
    || payload?.source
  ).toLowerCase();

  const audienceRole = normalizeText(
    candidate?.fields?.audience_role
    || candidate.audience_role
    || payload?.fields?.audience_role
    || payload?.audience_role
  );

  return {
    email: normalizeText(candidate.email || payload?.email).toLowerCase(),
    status: normalizeText(candidate.status || payload?.status).toLowerCase(),
    source: normalizedSource,
    audienceRole,
    groupIds,
  };
}

function isWaitlistWebhookSubscriber(subscriber) {
  const waitlistGroupId = getWaitlistGroupId();

  return subscriber.source === WAITLIST_SOURCE
    || (waitlistGroupId && subscriber.groupIds.includes(waitlistGroupId));
}

async function syncConfirmedWaitlistSubscriber({ email, source, audienceRole, apiToken, waveOverride }) {
  await ensureWaitlistStatsDoc();

  const waitlistCounted = await upsertWaitlistEntry(email, source || WAITLIST_SOURCE);
  const count = await getWaitlistCount();
  const wave = waveOverride || computeWave(count);

  if (apiToken) {
    try {
      await updateMailerLiteSubscriberFields(apiToken, email, buildWaitlistSubscriberFields({
        source,
        audienceRole,
        wave,
      }));
    } catch (error) {
      functions.logger.error('Unable to update waitlist wave on confirmation:', error);
    }
  }

  if (waitlistCounted) {
    try {
      await recordClubSignupResult(true, audienceRole);
    } catch (error) {
      functions.logger.error('Unable to record confirmed waitlist signup:', error);
    }
  }

  return { waitlistCounted, count, wave };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXmlEntities(value = '') {
  const entityMap = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: '\'',
    nbsp: ' ',
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (_, entity) => entityMap[entity] || `&${entity};`);
}

function stripHtml(value = '') {
  return decodeXmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractFirstTagValue(xml, tagNames) {
  for (const tagName of tagNames) {
    const regex = new RegExp(`<${escapeRegex(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegex(tagName)}>`, 'i');
    const match = xml.match(regex);
    if (match) return decodeXmlEntities(match[1]).trim();
  }
  return '';
}

function extractAttributeValue(xml, tagName, attribute) {
  const regex = new RegExp(`<${escapeRegex(tagName)}\\b[^>]*\\s${escapeRegex(attribute)}=["']([^"']+)["'][^>]*>`, 'i');
  const match = xml.match(regex);
  return match ? decodeXmlEntities(match[1]).trim() : '';
}

function stripChannelItems(channelXml) {
  const itemIndex = channelXml.search(/<item\b/i);
  return itemIndex >= 0 ? channelXml.slice(0, itemIndex) : channelXml;
}

function toIsoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString();
}

function comparePodcastEpisodes(leftEpisode, rightEpisode) {
  const leftTimestamp = Date.parse(leftEpisode.publishedAtIso || leftEpisode.publishedAt || '');
  const rightTimestamp = Date.parse(rightEpisode.publishedAtIso || rightEpisode.publishedAt || '');
  const leftHasTimestamp = !Number.isNaN(leftTimestamp);
  const rightHasTimestamp = !Number.isNaN(rightTimestamp);

  if (leftHasTimestamp && !rightHasTimestamp) return -1;
  if (!leftHasTimestamp && rightHasTimestamp) return 1;
  if (leftHasTimestamp && rightHasTimestamp && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  const leftEpisodeNumber = Number.parseInt(leftEpisode.episodeNumber, 10);
  const rightEpisodeNumber = Number.parseInt(rightEpisode.episodeNumber, 10);
  const leftHasEpisodeNumber = !Number.isNaN(leftEpisodeNumber);
  const rightHasEpisodeNumber = !Number.isNaN(rightEpisodeNumber);

  if (leftHasEpisodeNumber && !rightHasEpisodeNumber) return -1;
  if (!leftHasEpisodeNumber && rightHasEpisodeNumber) return 1;
  if (leftHasEpisodeNumber && rightHasEpisodeNumber && leftEpisodeNumber !== rightEpisodeNumber) {
    return rightEpisodeNumber - leftEpisodeNumber;
  }

  return 0;
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function parsePodcastRss(xml, podcastConfig) {
  const channelMatch = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i);
  const channelXml = channelMatch ? channelMatch[1] : xml;
  const channelHeaderXml = stripChannelItems(channelXml);
  const imageBlockMatch = channelHeaderXml.match(/<image\b[^>]*>([\s\S]*?)<\/image>/i);
  const imageBlock = imageBlockMatch ? imageBlockMatch[1] : '';

  const episodes = Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi))
    .map((match) => {
      const itemXml = match[1];
      const summary = stripHtml(
        extractFirstTagValue(itemXml, ['content:encoded', 'itunes:summary', 'description', 'summary'])
      );
      const publishedAt = extractFirstTagValue(itemXml, ['pubDate']);
      const link = extractFirstTagValue(itemXml, ['link']);
      const audioUrl = extractAttributeValue(itemXml, 'enclosure', 'url');

      return {
        id: extractFirstTagValue(itemXml, ['guid']) || link || audioUrl || extractFirstTagValue(itemXml, ['title']),
        title: extractFirstTagValue(itemXml, ['title']),
        summary: truncate(summary, 320),
        publishedAt,
        publishedAtIso: toIsoDate(publishedAt),
        duration: extractFirstTagValue(itemXml, ['itunes:duration', 'duration']),
        episodeNumber: extractFirstTagValue(itemXml, ['itunes:episode']),
        link,
        audioUrl,
        image: extractAttributeValue(itemXml, 'itunes:image', 'href'),
      };
    })
    .filter((episode) => episode.title)
    .sort(comparePodcastEpisodes);

  return {
    podcast: {
      slug: podcastConfig.slug,
      title: extractFirstTagValue(channelHeaderXml, ['title']) || podcastConfig.title,
      description: stripHtml(
        extractFirstTagValue(channelHeaderXml, ['itunes:summary', 'description'])
      ) || podcastConfig.description,
      image: extractAttributeValue(channelHeaderXml, 'itunes:image', 'href')
        || extractFirstTagValue(imageBlock, ['url']),
      website: extractFirstTagValue(channelHeaderXml, ['link']) || podcastConfig.siteUrl,
      rssUrl: podcastConfig.rssUrl,
      episodeCount: episodes.length,
      platforms: podcastConfig.platforms,
    },
    episodes,
  };
}

/* ── podcastFeed ────────────────────────────────────────────── */

exports.podcastFeed = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const requestedShow = typeof req.query.show === 'string' ? req.query.show.trim() : '';
  const podcastConfig = PODCAST_FEEDS[requestedShow];

  if (!podcastConfig) {
    res.status(400).json({
      error: 'Unknown podcast feed requested.',
      availableShows: Object.keys(PODCAST_FEEDS),
    });
    return;
  }

  try {
    const feedResponse = await fetch(podcastConfig.rssUrl, {
      headers: {
        'User-Agent': 'DoingLifeTodayPodcastFeed/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    });

    if (!feedResponse.ok) {
      const errorBody = await feedResponse.text();
      functions.logger.error(`Podcast feed upstream error ${feedResponse.status} for ${requestedShow}:`, errorBody);
      res.status(502).json({ error: 'Unable to retrieve the podcast feed right now.' });
      return;
    }

    const xml = await feedResponse.text();
    const payload = parsePodcastRss(xml, podcastConfig);

    res.set('Cache-Control', 'public, max-age=900, s-maxage=900');
    res.status(200).json(payload);
  } catch (error) {
    functions.logger.error(`Podcast feed network error for ${requestedShow}:`, error);
    res.status(502).json({ error: 'Unable to retrieve the podcast feed right now.' });
  }
});

/* ── publicConfig ───────────────────────────────────────────── */

exports.publicConfig = onRequest(
  async (req, res) => {
    setCorsHeaders(res, 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.set('Allow', 'GET');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    res.set('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({
      recaptchaSiteKey: getEnvValue('RECAPTCHA_SITE_KEY'),
    });
  }
);

/* ── subscribe ───────────────────────────────────────────────── */

exports.subscribe = onRequest(
  async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const body = parseBody(req);
    const { email, list, audienceRole, source, recaptchaToken, website_url, company_name_hidden, waveOverride } = body;
    const clientIp = getClientIp(req);
    const requestedList = typeof list === 'string' ? list.trim() : '';
    const validWaveOverride = Number.isInteger(Number(waveOverride)) && WAITLIST_TRACKING_WAVES.includes(Number(waveOverride)) ? Number(waveOverride) : null;

    if (!email || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    if (normalizeText(website_url || company_name_hidden)) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'subscribe',
        ip: clientIp,
        reason: 'honeypot_triggered',
        message: 'Submission rejected.',
      });
      return;
    }

    const rateLimit = await enforceSubmissionRateLimit('subscribe', clientIp);
    if (!rateLimit.allowed) {
      await rejectSubmission(res, {
        status: 429,
        endpoint: 'subscribe',
        ip: clientIp,
        reason: rateLimit.blocked ? 'ip_temporarily_blocked' : 'rate_limit_exceeded',
        message: rateLimit.blocked
          ? 'Too many attempts. Please try again later.'
          : 'Please wait at least 60 seconds before submitting again.',
        retryAfterMs: rateLimit.retryAfterMs,
      });
      return;
    }

    const captchaVerification = await verifyRecaptchaToken(recaptchaToken, clientIp);
    if (!captchaVerification.ok) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'subscribe',
        ip: clientIp,
        reason: 'recaptcha_failed',
        message: captchaVerification.reason,
      });
      return;
    }

    if (isLikelyRandomEmail(email)) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'subscribe',
        ip: clientIp,
        reason: 'email_failed_server_validation',
        message: 'Please use a valid email address.',
      });
      return;
    }

    const apiToken = getEnvValue('MAILERLITE_API_TOKEN');
    const groupIds = {
      newsletter: getEnvValue('MAILERLITE_GROUP_ID'),
      theclub_waitlist: getEnvValue('MAILERLITE_THECLUB_WAITLIST_GROUP_ID') || getEnvValue('MAILERLITE_GROUP_ID'),
    };
    const groupId = groupIds[requestedList] || groupIds.newsletter;

    if (!apiToken) {
      functions.logger.error('MAILERLITE_API_TOKEN is not set.');
      res.status(500).json({ error: 'Server configuration error. Please try again later.' });
      return;
    }

    let projectedWave = null;
    let projectedWaitlistCount = null;

    if (requestedList === 'theclub_waitlist') {
      await ensureWaitlistStatsDoc();
      projectedWaitlistCount = await getWaitlistCount();
      projectedWave = validWaveOverride || computeWave(projectedWaitlistCount + 1);
    }

    const payload = {
      email: email.trim().toLowerCase(),
      status: requestedList === 'theclub_waitlist' ? 'unconfirmed' : 'active',
    };
    if (groupId) payload.groups = [groupId];
    if (validWaveOverride && EVENT_WAVE_GROUPS[validWaveOverride]) {
      payload.groups = payload.groups || [];
      payload.groups.push(EVENT_WAVE_GROUPS[validWaveOverride]);
    }

    if (requestedList === 'theclub_waitlist') {
      payload.fields = buildWaitlistSubscriberFields({
        source,
        audienceRole,
        wave: projectedWave,
      });
    }

    functions.logger.info('MailerLite payload:', JSON.stringify(payload));

    try {
      const mlRes = await fetch(MAILERLITE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      });
      const mlData = await mlRes.json().catch(() => ({}));
      const subscriberStatus = normalizeText(mlData?.data?.status || payload.status).toLowerCase();

      functions.logger.info('MailerLite response status:', mlRes.status);

      if (mlRes.status === 200 || mlRes.status === 201) {
        let waitlistCounted = false;
        let count = null;
        let wave = null;

        if (requestedList === 'theclub_waitlist' && subscriberStatus === 'active') {
          const confirmationSync = await syncConfirmedWaitlistSubscriber({
            email,
            source,
            audienceRole,
            apiToken,
            waveOverride: validWaveOverride,
          });
          waitlistCounted = confirmationSync.waitlistCounted;
          count = confirmationSync.count;
          wave = confirmationSync.wave;
        } else if (requestedList === 'theclub_waitlist') {
          waitlistCounted = await upsertWaitlistEntry(email, source || WAITLIST_SOURCE);
          count = await getWaitlistCount();
          wave = validWaveOverride || computeWave(count);

          if (apiToken) {
            try {
              await updateMailerLiteSubscriberFields(apiToken, email, buildWaitlistSubscriberFields({
                source,
                audienceRole,
                wave,
              }));
            } catch (error) {
              functions.logger.error('Unable to update waitlist fields after signup:', error);
            }
          }

          if (waitlistCounted) {
            try {
              await recordClubSignupResult(true, audienceRole);
            } catch (error) {
              functions.logger.error('Unable to record waitlist signup:', error);
            }
          }
        }

        const responsePayload = {
          message: requestedList === 'theclub_waitlist'
            ? (waitlistCounted
              ? (subscriberStatus === 'active'
                ? "You're confirmed on the list. We'll notify you when your wave opens."
                : 'Check your inbox to confirm your email. Your place has been reserved and we will notify you when your wave opens.')
              : "You're already on the waitlist with this email. We'll notify you when your wave opens.")
            : 'Subscribed successfully!',
          waitlistCounted,
        };
        if (requestedList === 'theclub_waitlist') {
          responsePayload.alreadyReserved = !waitlistCounted;
        }
        if (count !== null) { responsePayload.count = count; responsePayload.wave = wave; }

        // WPC 2026 Phoenix: auto-approve QR-scan signups on the Club's
        // launch-allowlist so they can create an account immediately.
        // Only PwPs and care partners are eligible for The Club.
        // Best-effort: failure here must not break the response.
        const normalizedSource = normalizeText(source).toLowerCase();
        const normalizedRole = normalizeText(audienceRole).toLowerCase();
        const isClubEligibleRole = normalizedRole.includes('parkinson')
          || normalizedRole.includes('care partner')
          || normalizedRole.includes('caregiver')
          || normalizedRole.includes('spouse')
          || normalizedRole.includes('family');
        if ((normalizedSource === 'wpc_2026_phoenix' || normalizedSource.startsWith('wpc_')) && isClubEligibleRole) {
          const approved = await addToClubLaunchAllowlist({
            email,
            wave: 'wpc-2026-phoenix',
            source: 'wpc-2026-phoenix',
          });
          responsePayload.clubAllowlistApproved = approved;
          responsePayload.clubSignupUrl = 'https://club.dolifetoday.com/?auth=signup&email=' + encodeURIComponent(email.trim().toLowerCase());
        } else if ((normalizedSource === 'psgb_2026_collingwood' || normalizedSource.startsWith('psgb_')) && isClubEligibleRole) {
          // Parkinson's South Georgian Bay June Festival 2026 (Collingwood, ON):
          // QR-scan signups are auto-approved into "The One Hell of a Ride Wave"
          // — a special event wave that bypasses the regular waitlist.
          const approved = await addToClubLaunchAllowlist({
            email,
            wave: 'one-hell-of-a-ride',
            source: 'psgb-2026-collingwood',
          });
          responsePayload.clubAllowlistApproved = approved;
          responsePayload.clubSignupUrl = 'https://club.dolifetoday.com/?auth=signup&email=' + encodeURIComponent(email.trim().toLowerCase());
        }

        res.status(200).json(responsePayload);
        return;
      }

      if (mlRes.status === 422) {
        functions.logger.warn('MailerLite rejected subscribe payload', mlData);
        res.status(400).json({ error: 'Subscription could not be processed. Please review your details and try again.' });
        return;
      }

      functions.logger.error(`MailerLite error ${mlRes.status}:`, mlData);
      res.status(500).json({ error: 'Subscription failed. Please try again later.' });
    } catch (err) {
      functions.logger.error('Network error calling MailerLite:', err);
      res.status(502).json({ error: 'Unable to reach subscription service. Please try again later.' });
    }
  }
);

/* ── waitlistCount ─────────────────────────────────────────── */

exports.waitlistCount = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    await ensureWaitlistStatsDoc();
    const count = await getWaitlistCount();
    res.set('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({ count, wave: computeWave(count) });
  } catch (error) {
    functions.logger.error('Unable to read waitlist count:', error);
    res.status(500).json({ error: 'Unable to retrieve waitlist count.' });
  }
});

/* ── checkWave ─────────────────────────────────────────────── */

const WAVE_NAMES = {
  1: 'Founders Wave',
  2: 'Early Adopters Wave',
  3: 'Priority Access',
  4: 'Growth Wave',
  5: 'Community Wave',
  6: 'Final Wave',
  17: 'Ohio Wave',
};

const WAVE_OPEN_DATES = {
  1: 'Closed',
  2: 'Closed',
  3: 'May 13, 2026',
  4: 'May 27, 2026',
  5: 'June 10, 2026',
  6: 'June 24, 2026',
  17: 'April 21, 2026',
};

exports.checkWave = onRequest(
  async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const email = (req.query.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  /* Helper: look up subscriber status from MailerLite */
  async function getMailerLiteStatus(emailAddress) {
    const apiToken = getEnvValue('MAILERLITE_API_TOKEN');
    if (!apiToken) return { status: 'unknown', fields: {}, groupIds: [] };
    try {
      const mlResponse = await fetch(
        `${MAILERLITE_API_URL}/${encodeURIComponent(emailAddress)}`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      if (!mlResponse.ok) return { status: 'unknown', fields: {}, groupIds: [] };
      const mlPayload = await mlResponse.json();
      const subscriberData = mlPayload.data || mlPayload;
      return {
        status: normalizeText(subscriberData.status).toLowerCase() || 'unknown',
        fields: subscriberData.fields || {},
        groupIds: extractGroupIds(subscriberData.groups || []),
      };
    } catch (err) {
      functions.logger.warn('MailerLite status lookup failed:', err);
      return { status: 'unknown', fields: {}, groupIds: [] };
    }
  }

  const page = (req.query.page || 'check-wave').trim();

  try {
    const docId = buildWaitlistDocId(email);
    const snapshot = await db.collection('waitlist').doc(docId).get();

    if (snapshot.exists) {
      const data = snapshot.data();
      const userCreatedAt = data.createdAt;

      /* Count how many waitlist entries were created at or before this user */
      const [earlierSnapshot, legacyCount, mlInfo] = await Promise.all([
        db.collection('waitlist')
          .where('source', '==', 'club_waitlist')
          .where('createdAt', '<=', userCreatedAt)
          .count()
          .get(),
        getLegacyWaitlistCount(),
        getMailerLiteStatus(email),
      ]);

      const position = earlierSnapshot.data().count;
      const adjustedPosition = legacyCount + WAITLIST_MANUAL_COUNT_ADJUSTMENT + position;
      const wave = computeWave(adjustedPosition);
      const confirmed = mlInfo.status === 'active';

      recordCheckWaveEvent('lookup', { page }).catch(() => {});
      recordCheckWaveEvent('found', { page, wave }).catch(() => {});
      if (!confirmed) recordCheckWaveEvent('unconfirmed', { page, wave }).catch(() => {});

      res.set('Cache-Control', 'no-store, max-age=0');
      res.status(200).json({
        found: true,
        confirmed,
        wave,
        waveName: WAVE_NAMES[wave] || 'Wave ' + wave,
        opensAt: WAVE_OPEN_DATES[wave] || 'TBD',
        position: adjustedPosition,
      });
      return;
    }

    /* Firestore doc not found — check MailerLite for legacy/early subscribers */
    const mlInfo = await getMailerLiteStatus(email);
    if (mlInfo.status !== 'unknown') {
      const waitlistGroupId = getEnvValue('MAILERLITE_THECLUB_WAITLIST_GROUP_ID');
      const confirmed = mlInfo.status === 'active';

      /* If subscriber has a wave field from a prior sync, use it */
      const existingWave = Number(mlInfo.fields.wave);
      if (Number.isInteger(existingWave) && existingWave >= 1 && existingWave <= 6) {
        recordCheckWaveEvent('lookup', { page }).catch(() => {});
        recordCheckWaveEvent('found', { page, wave: existingWave }).catch(() => {});
        if (!confirmed) recordCheckWaveEvent('unconfirmed', { page, wave: existingWave }).catch(() => {});

        res.set('Cache-Control', 'no-store, max-age=0');
        res.status(200).json({
          found: true,
          confirmed,
          wave: existingWave,
          waveName: WAVE_NAMES[existingWave] || 'Wave ' + existingWave,
          opensAt: WAVE_OPEN_DATES[existingWave] || 'TBD',
        });
        return;
      }

      /* If subscriber is in the waitlist group, they're a legacy user (wave 1) */
      if (waitlistGroupId && mlInfo.groupIds.includes(waitlistGroupId)) {
        recordCheckWaveEvent('lookup', { page }).catch(() => {});
        recordCheckWaveEvent('found', { page, wave: 1 }).catch(() => {});
        if (!confirmed) recordCheckWaveEvent('unconfirmed', { page, wave: 1 }).catch(() => {});

        res.set('Cache-Control', 'no-store, max-age=0');
        res.status(200).json({
          found: true,
          confirmed,
          wave: 1,
          waveName: WAVE_NAMES[1],
          opensAt: WAVE_OPEN_DATES[1],
        });
        return;
      }
    }

    recordCheckWaveEvent('lookup', { page }).catch(() => {});
    recordCheckWaveEvent('not_found', { page }).catch(() => {});

    res.status(404).json({ found: false, message: "We didn't find that email on the waitlist. Double-check your spelling or sign up at dolifetoday.com/theclub." });
  } catch (error) {
    functions.logger.error('Unable to check wave:', error);
    res.status(500).json({ error: 'Unable to look up your wave. Please try again later.' });
  }
});

/* ── trackCheckWave ────────────────────────────────────────── */

exports.trackCheckWave = onRequest(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { eventType, page } = parseBody(req);

  try {
    await recordCheckWaveEvent(eventType, { page });
    res.status(200).json({ ok: true });
  } catch (error) {
    functions.logger.error('Unable to record check-wave event:', error);
    res.status(400).json({ error: 'Unable to record event.' });
  }
});

/* ── trackShare ────────────────────────────────────────────── */

exports.trackShare = onRequest(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { channel, page } = parseBody(req);
  const allowedChannels = new Set(['email', 'copy']);

  if (!allowedChannels.has(channel)) {
    res.status(400).json({ error: 'Invalid share channel.' });
    return;
  }

  try {
    await recordShareClick(channel, page);
    res.status(200).json({ ok: true });
  } catch (error) {
    functions.logger.error('Unable to record share click:', error);
    res.status(500).json({ error: 'Unable to record share click.' });
  }
});

/* ── trackClubAnalytics ────────────────────────────────────── */

exports.trackClubAnalytics = onRequest(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { eventType, location, source } = parseBody(req);
  const allowedLocations = new Set(Object.keys(DEFAULT_CTA_LOCATIONS));

  try {
    if (eventType === 'cta_click') {
      const normalizedLocation = allowedLocations.has(location) ? location : 'section';
      await recordClubCtaClick(normalizedLocation);
    } else {
      await recordClubAnalyticsEvent(eventType, {
        location: allowedLocations.has(location) ? location : undefined,
        source,
      });
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    functions.logger.error('Unable to record club analytics event:', error);
    res.status(400).json({ error: 'Unable to record club analytics event.' });
  }
});

/* ── trackInnerCircleLounge ────────────────────────────────
   POST /api/track-inner-circle-lounge  { eventType, source? }
   eventType ∈ page_view | unlock_success | unlock_failure |
              zoom_join_morning | zoom_join_evening | ics_download
   Silently succeeds on unknown eventType so we never break the
   client experience just because tracking failed. */

exports.trackInnerCircleLounge = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { eventType, source } = parseBody(req);
  if (!INNER_CIRCLE_LOUNGE_EVENTS[eventType]) {
    // Unknown event type — silently ignore, no analytics = no problem.
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  try {
    await recordInnerCircleLoungeEvent(eventType, { source });
    res.status(200).json({ ok: true });
  } catch (error) {
    functions.logger.error('Unable to record inner circle lounge event:', error);
    res.status(400).json({ error: 'Unable to record inner circle lounge event.' });
  }
});

/* ── shareStats ────────────────────────────────────────────── */

exports.shareStats = onRequest(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { password } = parseBody(req);
  const expectedPassword = process.env.STATS_PAGE_PASSWORD;

  if (!expectedPassword) {
    functions.logger.error('STATS_PAGE_PASSWORD is not set.');
    res.status(500).json({ error: 'Stats page password is not configured.' });
    return;
  }

  if (!secretsMatch(password, expectedPassword)) {
    res.status(401).json({ error: 'Invalid password.' });
    return;
  }

  try {
    const [shareStats, clubStats, innerCircleLoungeStats] = await Promise.all([
      getShareStats(),
      getClubPageStats(),
      getInnerCircleLoungeStats(),
    ]);

    const pageViews = Number(clubStats.totals.pageViews) || 0;
    const signups = Number(clubStats.totals.signups) || 0;
    res.set('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({
      share: shareStats,
      club: {
        ...clubStats,
        conversionRate: pageViews > 0 ? Number(((signups / pageViews) * 100).toFixed(1)) : 0,
      },
      innerCircleLounge: innerCircleLoungeStats,
    });
  } catch (error) {
    functions.logger.error('Unable to retrieve share stats:', error);
    res.status(500).json({ error: 'Unable to retrieve share stats.' });
  }
});

/* ── contact ─────────────────────────────────────────────────── */

// Inquiry types the form offers; label used in email subject + body.
const CONTACT_INQUIRY_LABELS = {
  general: 'General Inquiry',
  club: 'The Club',
  podcast: 'Podcast / Guest Submission',
  media: 'Media / Press',
  speaking: 'Speaking Inquiry',
  partnership: 'Partnership',
  technical: 'Technical Support',
  advocacy: 'Advocacy / Community',
  other: 'Other',
};

// All contact form submissions land in help@dolifetoday.com regardless of inquiry
// type. Override with CONTACT_NOTIFY_EMAIL env if a different inbox is needed.
const DEFAULT_CONTACT_INBOX = 'help@dolifetoday.com';

function resolveContactRecipients(_inquiryType) {
  const override = getEnvValue('CONTACT_NOTIFY_EMAIL');
  return { primary: (override || DEFAULT_CONTACT_INBOX), cc: [] };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendContactEmail({ recipients, name, email, organization, inquiryType, message, submissionId, clientIp }) {
  const apiKey = getEnvValue('MAILERSEND_API_KEY');
  if (!apiKey) {
    functions.logger.error('MAILERSEND_API_KEY is not set — cannot deliver contact form email.');
    return { ok: false, reason: 'missing_api_key' };
  }

  const inquiryLabel = CONTACT_INQUIRY_LABELS[inquiryType] || inquiryType || 'General Inquiry';
  const receivedIso = new Date().toISOString();
  const subject = `Contact form: ${inquiryLabel} — ${name}`;

  const textBody = [
    `New message from the Doing Life Today contact form.`,
    ``,
    `Name:         ${name}`,
    `Email:        ${email}`,
    `Organization: ${organization || '(none)'}`,
    `Inquiry:      ${inquiryLabel}`,
    ``,
    `Message`,
    `-------`,
    message,
    ``,
    `---`,
    `Submission ID: ${submissionId}`,
    `Received:      ${receivedIso}`,
    `Client IP:     ${clientIp || 'unknown'}`,
    `Reply directly to this email — it will go to ${email}.`,
  ].join('\n');

  const htmlBody = [
    '<div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937;max-width:640px;margin:0 auto;padding:24px;">',
    '<h1 style="font-size:20px;margin:0 0 16px;color:#1f2937;">New message from the DLT contact form</h1>',
    '<table style="border-collapse:collapse;font-size:15px;margin:0 0 20px;"><tbody>',
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Name</td><td style="padding:4px 0;"><strong>${escapeHtml(name)}</strong></td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Email</td><td style="padding:4px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Organization</td><td style="padding:4px 0;">${organization ? escapeHtml(organization) : '<em style="color:#9ca3af;">(none)</em>'}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Inquiry</td><td style="padding:4px 0;">${escapeHtml(inquiryLabel)}</td></tr>`,
    '</tbody></table>',
    `<div style="background:#f3f4f6;border-left:4px solid #1f7a8c;padding:14px 18px;border-radius:4px;white-space:pre-wrap;font-size:15px;">${escapeHtml(message)}</div>`,
    `<p style="margin:24px 0 6px;color:#6b7280;font-size:13px;">Submission ID: ${escapeHtml(submissionId)}<br>Received: ${escapeHtml(receivedIso)}<br>Client IP: ${escapeHtml(clientIp || 'unknown')}</p>`,
    `<p style="margin:0;color:#6b7280;font-size:13px;">Just hit <strong>Reply</strong> — your reply goes straight to <strong>${escapeHtml(email)}</strong>.</p>`,
    '</div>',
  ].join('');

  const payload = {
    from: { email: 'contact@dolifetoday.com', name: 'Doing Life Today Contact Form' },
    to: [{ email: recipients.primary }],
    reply_to: { email, name },
    subject,
    text: textBody,
    html: htmlBody,
  };
  if (recipients.cc && recipients.cc.length) {
    payload.cc = recipients.cc.map((addr) => ({ email: addr }));
  }

  try {
    const res = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const responseText = await res.text().catch(() => '');
    const messageIdHeader = res.headers.get('x-message-id') || '';
    functions.logger.info('MailerSend contact email response', {
      status: res.status,
      messageId: messageIdHeader,
      to: recipients.primary,
      cc: recipients.cc,
      body: responseText.slice(0, 500),
    });
    if (!res.ok) {
      functions.logger.error(`MailerSend contact email failed (${res.status}):`, responseText);
      return { ok: false, reason: 'mailersend_error', status: res.status };
    }
    return { ok: true };
  } catch (err) {
    functions.logger.error('Contact email send failed:', err && err.message ? err.message : err);
    return { ok: false, reason: 'network_error' };
  }
}

exports.contact = onRequest(
  { secrets: ['MAILERSEND_API_KEY', 'RECAPTCHA_SECRET_KEY'] },
  async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const {
      name,
      email,
      organization,
      inquiry_type,
      message,
      recaptchaToken,
      website_url,
      company_name_hidden,
    } = parseBody(req);
    const clientIp = getClientIp(req);

    const errors = [];
    if (!name || name.trim().length < 2) errors.push('Full name is required.');
    if (!email || !EMAIL_REGEX.test(email)) errors.push('A valid email address is required.');
    if (!inquiry_type) errors.push('Inquiry type is required.');
    if (!message || message.trim().length < 10) errors.push('Message must be at least 10 characters.');

    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    if (normalizeText(website_url || company_name_hidden)) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'contact',
        ip: clientIp,
        reason: 'honeypot_triggered',
        message: 'Submission rejected.',
      });
      return;
    }

    // Verify reCAPTCHA before touching the rate limiter so a transient
    // spam-filter failure doesn't burn a rate-limit slot on legit users.
    const captchaVerification = await verifyRecaptchaToken(recaptchaToken, clientIp);
    if (!captchaVerification.ok) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'contact',
        ip: clientIp,
        reason: 'recaptcha_failed',
        message: captchaVerification.reason,
      });
      return;
    }

    const rateLimit = await enforceSubmissionRateLimit('contact', clientIp);
    if (!rateLimit.allowed) {
      await rejectSubmission(res, {
        status: 429,
        endpoint: 'contact',
        ip: clientIp,
        reason: rateLimit.blocked ? 'ip_temporarily_blocked' : 'rate_limit_exceeded',
        message: rateLimit.blocked
          ? 'Too many attempts. Please try again later.'
          : 'Please wait at least 60 seconds before submitting again.',
        retryAfterMs: rateLimit.retryAfterMs,
      });
      return;
    }

    if (isLikelySpamName(name)) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'contact',
        ip: clientIp,
        reason: 'name_failed_server_validation',
        message: 'Please enter your full name.',
      });
      return;
    }

    if (isLikelyRandomEmail(email)) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'contact',
        ip: clientIp,
        reason: 'email_failed_server_validation',
        message: 'Please use a valid email address.',
      });
      return;
    }

    if (isLikelySpamCompany(organization)) {
      await rejectSubmission(res, {
        status: 400,
        endpoint: 'contact',
        ip: clientIp,
        reason: 'company_failed_server_validation',
        message: 'Please review the organization field and try again.',
      });
      return;
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim();
    const normalizedOrg = (organization || '').trim();
    const normalizedInquiry = String(inquiry_type || '').trim().toLowerCase();
    const fullMessage = message.trim();
    const recipients = resolveContactRecipients(normalizedInquiry);

    // Durable log first — email delivery may fail but we still have the message.
    let submissionId = 'unknown';
    try {
      const submissionRef = await db.collection('contact_submissions').add({
        name: normalizedName,
        email: normalizedEmail,
        organization: normalizedOrg,
        inquiryType: normalizedInquiry,
        inquiryLabel: CONTACT_INQUIRY_LABELS[normalizedInquiry] || normalizedInquiry,
        message: fullMessage,
        recipient: recipients.primary,
        cc: recipients.cc,
        clientIp,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        status: 'received',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      submissionId = submissionRef.id;
    } catch (err) {
      functions.logger.error('Failed to persist contact submission to Firestore:', err && err.message ? err.message : err);
    }

    const emailResult = await sendContactEmail({
      recipients,
      name: normalizedName,
      email: normalizedEmail,
      organization: normalizedOrg,
      inquiryType: normalizedInquiry,
      message: fullMessage,
      submissionId,
      clientIp,
    });

    if (submissionId !== 'unknown') {
      try {
        await db.collection('contact_submissions').doc(submissionId).update({
          emailStatus: emailResult.ok ? 'sent' : 'failed',
          emailError: emailResult.ok ? admin.firestore.FieldValue.delete() : (emailResult.reason || 'unknown'),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        functions.logger.warn('Failed to update contact submission email status:', err && err.message ? err.message : err);
      }
    }

    if (!emailResult.ok && submissionId === 'unknown') {
      // Both persistence and email failed — surface a soft error so the user retries or falls back to mailto.
      res.status(502).json({ error: 'Message could not be delivered right now. Please email help@dolifetoday.com directly.' });
      return;
    }

    res.status(200).json({ message: "Message received! We'll be in touch within 24-48 hours." });
  }
);

/* ── mailerLiteWebhook ─────────────────────────────────────── */

exports.mailerLiteWebhook = onRequest(
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const webhookSecret = getEnvValue('MAILERLITE_WEBHOOK_SECRET');

    if (!webhookSecret) {
      functions.logger.error('MAILERLITE_WEBHOOK_SECRET is not set.');
      res.status(500).json({ error: 'Webhook secret is not configured.' });
      return;
    }

    if (!verifyWebhookSignature(req, webhookSecret)) {
      functions.logger.warn('Invalid MailerLite webhook signature');
      res.status(401).json({ error: 'Invalid signature.' });
      return;
    }

    const payload = parseBody(req);
    const eventName = extractMailerLiteEventName(payload).toLowerCase();
    const subscriber = extractWebhookSubscriber(payload);

    functions.logger.info('MailerLite webhook received', {
      eventName: eventName || 'unknown',
      email: subscriber.email || '',
      status: subscriber.status || '',
      source: subscriber.source || '',
      groupIds: subscriber.groupIds,
    });

    if (!subscriber.email || !isWaitlistWebhookSubscriber(subscriber)) {
      functions.logger.info('MailerLite webhook ignored', {
        eventName: eventName || 'unknown',
        email: subscriber.email || '',
        source: subscriber.source || '',
        groupIds: subscriber.groupIds,
        reason: !subscriber.email ? 'missing_email' : 'not_waitlist_subscriber',
      });
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    try {
      if (
        eventName === 'subscriber.active'
        || (eventName === 'subscriber.updated' && subscriber.status === 'active')
      ) {
        const syncResult = await syncConfirmedWaitlistSubscriber({
          email: subscriber.email,
          source: subscriber.source || WAITLIST_SOURCE,
          audienceRole: subscriber.audienceRole,
          apiToken: getEnvValue('MAILERLITE_API_TOKEN'),
        });

        functions.logger.info('MailerLite waitlist subscriber synced', {
          eventName,
          email: subscriber.email,
          waitlistCounted: syncResult.waitlistCounted,
          count: syncResult.count,
          wave: syncResult.wave,
        });

        res.status(200).json({ ok: true, synced: syncResult.waitlistCounted, count: syncResult.count, wave: syncResult.wave });
        return;
      }

      if (
        eventName === 'subscriber.unsubscribed'
        || eventName === 'subscriber.removed_from_group'
        || eventName === 'subscriber.deleted'
        || eventName === 'subscriber.bounced'
        || eventName === 'subscriber.spam_reported'
      ) {
        const removed = await removeWaitlistEntry(subscriber.email);
        functions.logger.info('MailerLite waitlist subscriber removed', {
          eventName,
          email: subscriber.email,
          removed,
        });
        res.status(200).json({ ok: true, removed });
        return;
      }

      res.status(200).json({ ok: true, ignored: true, event: eventName || 'unknown' });
    } catch (error) {
      functions.logger.error('Unable to process MailerLite webhook:', error);
      res.status(500).json({ error: 'Unable to process webhook.' });
    }
  }
);

/* ── youtubeLatest ───────────────────────────────────────────── */

exports.youtubeLatest = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const requestedPlaylistId = normalizeText(req.query?.playlistId);

  if (!apiKey || !channelId) {
    functions.logger.error('YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID is not set.');
    res.status(500).json({ error: 'Missing YouTube environment variables.' });
    return;
  }

  try {
    const channelUrl =
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics,snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;

    const channelResp = await fetch(channelUrl);
    const channelData = await channelResp.json();

    if (!channelData.items || !channelData.items.length) {
      res.status(404).json({ error: 'Channel not found.' });
      return;
    }

    const channel = channelData.items[0];
    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
    const playlistId = requestedPlaylistId || uploadsPlaylistId;

    const playlistUrl =
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=1&key=${encodeURIComponent(apiKey)}`;

    const playlistResp = await fetch(playlistUrl);
    const playlistData = await playlistResp.json();

    if (!playlistData.items || !playlistData.items.length) {
      res.status(404).json({ error: 'No uploaded videos found.' });
      return;
    }

    const latest = playlistData.items[0];
    const snippet = latest.snippet;
    const videoId = snippet.resourceId.videoId;

    res.set('Cache-Control', 'public, max-age=900, s-maxage=900');

    res.json({
      channelTitle: channel.snippet.title,
      subscriberCount: channel.statistics.subscriberCount || '0',
      videoCount: channel.statistics.videoCount || '0',
      viewCount: channel.statistics.viewCount || '0',
      playlistId,
      videoId,
      title: snippet.title,
      publishedAt: snippet.publishedAt,
      thumbnail:
        (snippet.thumbnails && snippet.thumbnails.maxres && snippet.thumbnails.maxres.url) ||
        (snippet.thumbnails && snippet.thumbnails.high && snippet.thumbnails.high.url) ||
        (snippet.thumbnails && snippet.thumbnails.medium && snippet.thumbnails.medium.url) ||
        (snippet.thumbnails && snippet.thumbnails.default && snippet.thumbnails.default.url) ||
        '',
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      subscribeUrl: `https://www.youtube.com/channel/${channelId}?sub_confirmation=1`,
    });
  } catch (err) {
    functions.logger.error('YouTube API error:', err);
    res.status(500).json({ error: 'Failed to fetch YouTube data.' });
  }
});

/* ════════════════════════════════════════════════════════════════
   PROVIDER ECOSYSTEM — Auth, CRUD, Admin, Sync
   ════════════════════════════════════════════════════════════════ */

const PROVIDERS_COLLECTION = 'providers';
const PROVIDER_ACCOUNTS_COLLECTION = 'provider_accounts';
const PROVIDER_EMAILS_COLLECTION = 'provider_emails';
const ADMIN_UIDS = new Set((process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean));

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

async function verifyProviderToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

async function sendProviderEmail(to, subject, textBody, htmlBody) {
  const apiKey = getEnvValue('MAILERSEND_API_KEY');
  if (!apiKey) {
    functions.logger.warn('MAILERSEND_API_KEY not set — skipping provider email');
    return;
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    functions.logger.warn('Invalid recipient for provider email:', to);
    return;
  }
  try {
    const res = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: { email: 'exchange@dolifetoday.com', name: 'The Exchange – Doing Life Today' },
        to: [{ email: to }],
        reply_to: { email: 'exchange@dolifetoday.com', name: 'The Exchange – Doing Life Today' },
        subject,
        text: textBody,
        html: htmlBody || textBody,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      functions.logger.error(`MailerSend API error (${res.status}):`, errText);
    }
  } catch (err) {
    functions.logger.error('Provider email send failed:', err);
  }
}

function buildProviderEmailHtml(title, paragraphs, ctaLink) {
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const ctaButton = ctaLink
    ? `<p style="margin:24px 0 16px;"><a href="${esc(ctaLink.url)}" style="display:inline-block;background-color:#1f7a8c;color:#ffffff;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:16px;">${esc(ctaLink.label)}</a></p>`
    : '';
  return [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;padding:24px;">',
    `<h1 style="font-size:22px;line-height:1.3;margin:0 0 20px;color:#1f2937;">${esc(title)}</h1>`,
    ...paragraphs.map(p => `<p style="margin:0 0 14px;">${p}</p>`),
    ctaButton,
    '<p style="margin:24px 0 0;color:#6b7280;font-size:14px;">— The Exchange, Doing Life Today</p>',
    '</div>',
  ].join('');
}

/* ── Provider Sign Up ──────────────────────────────────────── */

exports.providerSignup = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const { email, password, name } = parseBody(req);
  if (!email || !EMAIL_REGEX.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' }); return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' }); return;
  }
  if (!name || name.trim().length < 2) {
    res.status(400).json({ error: 'Name is required.' }); return;
  }

  try {
    const userRecord = await admin.auth().createUser({
      email: email.trim().toLowerCase(),
      password,
      displayName: name.trim(),
    });

    await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(userRecord.uid).set({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: 'provider',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Sign in the new user to get a real ID token (customTokens don't work with verifyIdToken)
    const apiKey = getEnvValue('WEB_API_KEY');
    if (!apiKey) {
      res.status(500).json({ error: 'Server configuration error.' }); return;
    }
    const authRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, returnSecureToken: true }),
      }
    );
    const authData = await authRes.json();
    const idToken = authData.idToken || '';

    res.status(201).json({
      token: idToken,
      expiresIn: parseInt(authData.expiresIn, 10) * 1000 || 3600000,
      user: { uid: userRecord.uid, email: userRecord.email, name: name.trim() },
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    } else {
      functions.logger.error('Provider signup error:', err);
      res.status(500).json({ error: 'Unable to create account. Please try again.' });
    }
  }
});

/* ── Provider Sign In ──────────────────────────────────────── */

exports.providerSignin = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const { email, password } = parseBody(req);
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' }); return;
  }

  try {
    // Use Firebase Auth REST API to verify password
    const apiKey = getEnvValue('WEB_API_KEY');
    if (!apiKey) {
      res.status(500).json({ error: 'Server configuration error.' }); return;
    }

    const authRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          returnSecureToken: true,
        }),
      }
    );

    const authData = await authRes.json();
    if (!authRes.ok) {
      const msg = authData.error?.message || '';
      if (msg.includes('EMAIL_NOT_FOUND') || msg.includes('INVALID_PASSWORD') || msg.includes('INVALID_LOGIN_CREDENTIALS')) {
        res.status(401).json({ error: 'Invalid email or password.' });
      } else {
        res.status(401).json({ error: 'Authentication failed.' });
      }
      return;
    }

    const uid = authData.localId;
    const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(uid).get();
    const accountData = accountDoc.exists ? accountDoc.data() : {};

    // Look up claimed provider listing to include in response
    let providerInfo = null;
    try {
      const claimedSnap = await db.collection(PROVIDERS_COLLECTION)
        .where('claimedBy', '==', uid)
        .where('status', '==', 'APPROVED')
        .limit(1)
        .get();
      if (!claimedSnap.empty) {
        const pData = claimedSnap.docs[0].data();
        providerInfo = {
          id: claimedSnap.docs[0].id,
          externalProviderId: pData.externalProviderId || null,
          name: pData.name || '',
          tier: pData.tier || 'FREE',
          status: pData.status || '',
        };
      }
    } catch (lookupErr) {
      functions.logger.warn('Provider listing lookup failed:', lookupErr.message);
    }

    res.status(200).json({
      token: authData.idToken,
      expiresIn: parseInt(authData.expiresIn, 10) * 1000 || 3600000,
      user: {
        uid,
        email: authData.email,
        name: accountData.name || authData.displayName || '',
      },
      provider: providerInfo,
    });
  } catch (err) {
    functions.logger.error('Provider signin error:', err);
    res.status(500).json({ error: 'Unable to sign in. Please try again.' });
  }
});

/* ── Club Auth Link ────────────────────────────────────────── */
/* Called by club app after creating a pcn---new account to link the
   pathway-providers record to the new user. Requires the idToken from
   providerSignin (doing-life-today project) to prove ownership. */

exports.providerClubLink = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const { pcnUid } = parseBody(req);
  if (!pcnUid || typeof pcnUid !== 'string') {
    res.status(400).json({ error: 'pcnUid is required.' }); return;
  }

  try {
    const dltUid = decoded.uid;

    // Find the APPROVED provider record claimed by this user
    const claimedSnap = await db.collection(PROVIDERS_COLLECTION)
      .where('claimedBy', '==', dltUid)
      .where('status', '==', 'APPROVED')
      .limit(1)
      .get();

    if (claimedSnap.empty) {
      res.status(404).json({ error: 'No approved provider listing found for this account.' }); return;
    }

    const providerData = claimedSnap.docs[0].data();
    let extId = providerData.externalProviderId;

    // If no externalProviderId, search pathway-providers by name to find the record
    if (!extId && providerData.name) {
      try {
        const nameSnap = await pcnDb.collection('pathway-providers')
          .where('name', '==', providerData.name)
          .limit(5)
          .get();
        if (!nameSnap.empty) {
          // Prefer an unlinked record (no ownerId)
          const unlinked = nameSnap.docs.find(d => !d.data().ownerId);
          const match = unlinked || nameSnap.docs[0];
          extId = match.id;
          // Back-fill externalProviderId on the providers record
          await db.collection(PROVIDERS_COLLECTION).doc(claimedSnap.docs[0].id).update({ externalProviderId: extId });
        }
      } catch (searchErr) {
        functions.logger.warn('Pathway-providers name search failed:', searchErr.message);
      }
    }

    if (!extId) {
      res.status(404).json({ error: 'Provider listing has no linked pathway record.' }); return;
    }

    // Get the account email
    let accountEmail = decoded.email || '';
    if (!accountEmail) {
      const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(dltUid).get();
      accountEmail = accountDoc.exists ? (accountDoc.data().email || '') : '';
    }

    // Update the pathway-providers record in pcn---new project
    const tierMap = { 'FREE': 'free', 'COMMUNITY': 'community', 'PREMIUM': 'premium', 'ENTERPRISE': 'enterprise' };
    const rawTier = (providerData.tier || 'community').toUpperCase();
    const subscriptionTier = tierMap[rawTier] || rawTier.toLowerCase();
    // Convert Firestore Timestamps to milliseconds so the client can use new Date()
    const toMs = (ts) => {
      if (!ts) return null;
      if (typeof ts === 'number') return ts;
      if (ts.toMillis) return ts.toMillis();
      if (ts.seconds) return ts.seconds * 1000;
      return null;
    };
    const partnerSince = toMs(providerData.approvedAt) || toMs(providerData.claimedAt) || toMs(providerData.createdAt) || Date.now();

    await pcnDb.collection('pathway-providers').doc(extId).update({
      ownerId: pcnUid,
      email: accountEmail.toLowerCase(),
      subscriptionTier,
      partnerSince,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      success: true,
      externalProviderId: extId,
      providerName: providerData.name || '',
    });
  } catch (err) {
    functions.logger.error('Provider club link error:', err);
    res.status(500).json({ error: 'Unable to link provider account.' });
  }
});

/* ── Create Listing ────────────────────────────────────────── */

exports.providerCreate = onRequest({ secrets: ['MAILERSEND_API_KEY'] }, async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const body = parseBody(req);
  const name = normalizeText(body.name);
  if (!name || name.length < 2) {
    res.status(400).json({ error: 'Organization name is required.' }); return;
  }

  const slug = slugify(name) + '-' + Date.now().toString(36);

  const providerDoc = {
    name,
    slug,
    category: normalizeText(body.category) || 'other',
    format: normalizeText(body.format) || 'in-person',
    city: normalizeText(body.city),
    state: normalizeText(body.state),
    country: normalizeText(body.country),
    description: (body.description || '').trim().slice(0, 2000),
    website: (body.website || '').trim().slice(0, 500),
    phone: (body.phone || '').trim().slice(0, 50),
    contactEmail: (body.contactEmail || '').trim().slice(0, 200),
    language: normalizeText(body.language) || 'English',
    tags: typeof body.tags === 'string'
      ? body.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
      : [],
    status: 'PENDING',
    tier: 'FREE',
    claimedBy: decoded.uid,
    views: 0,
    clicks: 0,
    searchAppearances: 0,
    clubData: { discussion_count: 0, review_count: 0, club_views: 0 },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection(PROVIDERS_COLLECTION).add(providerDoc);

  await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).set(
    { providerId: docRef.id, providerSlug: slug },
    { merge: true }
  );

  const createSubject = 'Your listing is under review \ud83d\udc40';
  const createTextBody = `Your listing ${name} has been submitted to The Exchange and is currently under review.\n\nThis usually takes 24-48 hours. You'll receive another email once it's been approved.\n\nWhile you're waiting, just a quick note...\n\nThe Exchange is part of a growing community inside Doing Life Today - where people living with Parkinson's and care partners connect, share, and discover resources like yours every day.\n\nOnce approved, your listing won't just be visible... it'll be part of real conversations happening in the community.\n\nView your dashboard: https://dolifetoday.com/provider-dashboard`;
  const createHtmlBody = buildProviderEmailHtml('Your listing is under review \ud83d\udc40', [
    `Your listing <strong>${name}</strong> has been submitted to The Exchange and is currently under review.`,
    'This usually takes <strong>24\u201348 hours</strong>. You\'ll receive another email once it\'s been approved.',
    'While you\'re waiting, just a quick note\u2026',
    'The Exchange is part of a growing community inside <strong>Doing Life Today</strong> \u2014 where people living with Parkinson\'s and care partners connect, share, and discover resources like yours every day.',
    'Once approved, your listing won\'t just be visible\u2026<br>it\'ll be part of <strong>real conversations</strong> happening in the community.',
  ], { url: 'https://dolifetoday.com/provider-dashboard', label: '\ud83d\udc49 View Your Dashboard' });
  await sendProviderEmail(decoded.email || '', createSubject, createTextBody, createHtmlBody);

  res.status(201).json({ id: docRef.id, slug, status: 'PENDING' });
});

/* ── Claim Listing ─────────────────────────────────────────── */

exports.providerClaim = onRequest({ secrets: ['MAILERSEND_API_KEY'] }, async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const body = parseBody(req);
  const providerId = normalizeText(body.providerId);
  const providerName = normalizeText(body.providerName);
  const role = normalizeText(body.role);
  const relevanceStatement = normalizeText(body.relevanceStatement).slice(0, 2000);

  if (!providerName) {
    res.status(400).json({ error: 'Provider information is required.' }); return;
  }

  // Check if listing is already claimed
  if (providerId) {
    try {
      const existingClaims = await db.collection(PROVIDERS_COLLECTION)
        .where('externalProviderId', '==', providerId)
        .where('status', 'in', ['PENDING', 'APPROVED'])
        .limit(1).get();
      if (!existingClaims.empty) {
        res.status(409).json({
          error: 'ALREADY_CLAIMED',
          message: 'This listing is already managed. Request access?',
        });
        return;
      }
    } catch (indexErr) {
      console.error('Claim duplicate-check query failed (index may be missing):', indexErr.message);
    }
  }

  // Fetch the ORIGINAL Exchange listing so we can compute vetting signals
  // (domain match, PD relevance) at submission time — used both to reject
  // obvious spam and to gate the required-statement field client-side.
  let listedWebsite = '';
  let listedType = '';
  let listedPhone = '';
  let listedLocation = '';
  if (providerId) {
    try {
      const extDoc = await pcnDb.collection('pathway-providers').doc(providerId).get();
      if (extDoc.exists) {
        const ed = extDoc.data() || {};
        listedWebsite = ed.website || '';
        listedType = ed.type || '';
        listedPhone = ed.phone || '';
        listedLocation = ed.location || '';
      }
    } catch (extErr) {
      functions.logger.warn('Claim: could not fetch listing for vetting', {
        providerId, error: extErr.message,
      });
    }
  }

  const signals = assessProviderClaim({
    email: decoded.email || '',
    listedWebsite,
    providerName,
    listedType,
  });

  // Hard reject: disposable/burner emails have no legitimate use case for
  // claiming a provider listing.
  if (signals.isDisposableEmail) {
    res.status(400).json({
      error: 'DISPOSABLE_EMAIL',
      message: 'Please use a real business email address to submit a claim.',
    });
    return;
  }

  // Require a relevance statement whenever we can't auto-verify the claim
  // via domain match. This adds friction that deters spam and gives the
  // reviewer real context to judge the claim on.
  if (!signals.autoVerified) {
    if (!relevanceStatement || relevanceStatement.length < 30) {
      res.status(400).json({
        error: 'RELEVANCE_STATEMENT_REQUIRED',
        message: 'Please briefly describe your organization\'s Parkinson\'s relevance and your role (at least 30 characters).',
        signals: {
          domainMatch: signals.domainMatch,
          isPersonalEmail: signals.isPersonalEmail,
          hasListedWebsite: Boolean(listedWebsite),
        },
      });
      return;
    }
  }

  const slug = slugify(providerName) + '-' + Date.now().toString(36);

  const claimDoc = {
    name: providerName,
    slug,
    externalProviderId: providerId,
    claimRole: role,
    claimPhone: (body.phone || '').trim().slice(0, 50),
    claimRelevanceStatement: relevanceStatement,
    claimVetting: {
      emailDomain: signals.emailDomain,
      siteDomain: signals.siteDomain,
      domainMatch: signals.domainMatch,
      isPersonalEmail: signals.isPersonalEmail,
      autoVerified: signals.autoVerified,
      pdRelevanceLikely: signals.pdRelevanceLikely,
      listedWebsite,
      listedPhone,
      listedLocation,
      listedType,
      assessedAt: Date.now(),
    },
    status: 'PENDING',
    tier: 'FREE',
    claimedBy: decoded.uid,
    category: '',
    format: '',
    city: '',
    state: '',
    country: '',
    description: '',
    website: '',
    phone: '',
    contactEmail: '',
    language: 'English',
    tags: [],
    views: 0,
    clicks: 0,
    searchAppearances: 0,
    clubData: { discussion_count: 0, review_count: 0, club_views: 0 },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection(PROVIDERS_COLLECTION).add(claimDoc);

  await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).set(
    { providerId: docRef.id, providerSlug: slug },
    { merge: true }
  );

  const claimSubject = 'Your claim is under review \ud83d\udc40';
  const claimTextBody = `Your claim for ${providerName} has been submitted to The Exchange and is currently under review.\n\nThis usually takes 24-48 hours. You'll receive another email once it's been approved.\n\nWhile you're waiting, just a quick note...\n\nThe Exchange is part of a growing community inside Doing Life Today - where people living with Parkinson's and care partners connect, share, and discover resources like yours every day.\n\nOnce approved, your listing won't just be visible... it'll be part of real conversations happening in the community.\n\nView your dashboard: https://dolifetoday.com/provider-dashboard`;
  const claimHtmlBody = buildProviderEmailHtml('Your claim is under review \ud83d\udc40', [
    `Your claim for <strong>${providerName}</strong> has been submitted to The Exchange and is currently under review.`,
    'This usually takes <strong>24\u201348 hours</strong>. You\'ll receive another email once it\'s been approved.',
    'While you\'re waiting, just a quick note\u2026',
    'The Exchange is part of a growing community inside <strong>Doing Life Today</strong> \u2014 where people living with Parkinson\'s and care partners connect, share, and discover resources like yours every day.',
    'Once approved, your listing won\'t just be visible\u2026<br>it\'ll be part of <strong>real conversations</strong> happening in the community.',
  ], { url: 'https://dolifetoday.com/provider-dashboard', label: '\ud83d\udc49 View Your Dashboard' });
  await sendProviderEmail(decoded.email || '', claimSubject, claimTextBody, claimHtmlBody);

  // Notify admin so they can review quickly (don't block the response).
  try {
    // Fallback to office@dolifetoday.com if the env var isn't set — this
    // notification broke silently for months in early 2026 because
    // ADMIN_NOTIFY_EMAIL wasn't loaded in the deployed function, and again
    // in mid-2026 when it was set to an inbox nobody was watching. The
    // hardcoded fallback ensures Bryce always gets the alert.
    const adminNotifyEmail = process.env.ADMIN_NOTIFY_EMAIL || 'office@dolifetoday.com';
    if (adminNotifyEmail) {
      const where = [body.city, body.stateProvince].filter(Boolean).join(', ');
      const verdict = signals.autoVerified
        ? '✅ Auto-verified (email domain matches listed website)'
        : (signals.domainMatch === 'mismatch' ? '⚠️ Email domain does NOT match listed website — manual review needed'
            : (signals.isPersonalEmail ? '🟡 Personal email — manual review needed'
                : '🔍 Manual review needed'));
      const relevanceLine = signals.pdRelevanceLikely
        ? '✦ Provider name/type suggests Parkinson\'s relevance'
        : '❔ No Parkinson\'s relevance keywords in provider name/type';
      const statementBlock = relevanceStatement
        ? `\n\nClaimant statement:\n"${relevanceStatement}"\n`
        : '';
      const adminSubject = signals.autoVerified
        ? `✅ New claim (auto-verified): ${providerName}`
        : `🔔 New claim (manual review): ${providerName}`;
      const adminText = `New provider claim awaiting review.\n\n${verdict}\n${relevanceLine}\n\nProvider: ${providerName}\nListed website: ${listedWebsite || '(none)'}\nListed type: ${listedType || '(none)'}\nLocation: ${where || listedLocation || '(not provided)'}\nClaimed by: ${decoded.email || decoded.uid}\nRole: ${role || '(not provided)'}\nDoc ID: ${docRef.id}${statementBlock}\nReview: https://dolifetoday.com/admin-providers`;
      const statementHtml = relevanceStatement
        ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #b8711a;background:#fef9e7;color:#333;font-style:italic;">${normalizeText(relevanceStatement).replace(/</g, '&lt;').slice(0, 1000)}</blockquote>`
        : '';
      const adminHtml = buildProviderEmailHtml('🔔 New provider claim awaiting review', [
        `<strong>${verdict}</strong>`,
        relevanceLine,
        `<strong>Provider:</strong> ${providerName}`,
        `<strong>Listed website:</strong> ${listedWebsite ? `<a href="${listedWebsite.startsWith('http') ? listedWebsite : 'https://' + listedWebsite}">${listedWebsite}</a>` : '(none)'}`,
        `<strong>Listed type:</strong> ${listedType || '(none)'}`,
        `<strong>Location:</strong> ${where || listedLocation || '(not provided)'}`,
        `<strong>Claimed by:</strong> ${decoded.email || decoded.uid}`,
        `<strong>Role:</strong> ${role || '(not provided)'}`,
        `<strong>Doc ID:</strong> ${docRef.id}`,
        statementHtml || '<em>No claimant statement provided (auto-verified).</em>',
      ], { url: 'https://dolifetoday.com/admin-providers', label: 'Review in Admin' });
      sendProviderEmail(adminNotifyEmail, adminSubject, adminText, adminHtml).catch((err) => {
        console.error('Admin claim notification failed:', err.message);
      });
    }
  } catch (err) {
    console.error('Admin claim notification setup failed:', err.message);
  }

  res.status(201).json({ id: docRef.id, slug, status: 'PENDING' });
});

/* ── Provider Dashboard ────────────────────────────────────── */

exports.providerDashboard = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).get();
  if (!accountDoc.exists || !accountDoc.data().providerId) {
    res.status(404).json({ error: 'No provider listing found. Please create or claim a listing first.' }); return;
  }

  const providerId = accountDoc.data().providerId;
  const providerDoc = await db.collection(PROVIDERS_COLLECTION).doc(providerId).get();
  if (!providerDoc.exists) {
    res.status(404).json({ error: 'Provider listing not found.' }); return;
  }

  const data = providerDoc.data();
  const views = data.views || 0;
  const clubData = data.clubData || {};
  const disc = clubData.discussion_count || 0;
  const revs = clubData.review_count || 0;
  const tier = (data.tier || 'FREE').toUpperCase();

  // Behavioral signals
  const signals = {
    discovery: views > 10 ? 'People are actively finding you' : null,
    discussion: disc > 0 ? "You're being talked about right now" : null,
    reviews: revs > 0 ? 'Feedback is being shared about services like yours' : null,
  };

  // Upgrade scoring
  const upgradeScore = (views * 0.2) + (disc * 5) + (revs * 5);
  const upgradeLevel = upgradeScore > 50 ? 'HIGH' : upgradeScore > 20 ? 'MEDIUM' : 'LOW';
  const nextStep = tier === 'FREE' ? 'UPGRADE_VERIFIED' : tier === 'VERIFIED' ? 'JOIN_CLUB' : null;

  // Trending (includes boostScore for approved COMMUNITY providers)
  const trendingScore = (views * 1) + (disc * 5) + (revs * 5) + (data.boostScore || 0);
  const TRENDING_THRESHOLD = 15;
  const isTrending = trendingScore > TRENDING_THRESHOLD;

  // Check for email triggers asynchronously
  checkEmailTriggers({ ...data, id: providerDoc.id }, decoded.email || '').catch(() => {});

  // Track trending state changes (non-blocking)
  const wasTrending = !!data._wasTrending;
  if (isTrending && !wasTrending) {
    db.collection(ANALYTICS_COLLECTION).add({ eventName: 'became_trending', provider_id: providerDoc.id, tier, timestamp: Date.now() }).catch(() => {});
    db.collection(PROVIDERS_COLLECTION).doc(providerDoc.id).update({ _wasTrending: true }).catch(() => {});
  } else if (!isTrending && wasTrending) {
    db.collection(ANALYTICS_COLLECTION).add({ eventName: 'lost_trending', provider_id: providerDoc.id, tier, timestamp: Date.now() }).catch(() => {});
    db.collection(PROVIDERS_COLLECTION).doc(providerDoc.id).update({ _wasTrending: false }).catch(() => {});
  }

  res.status(200).json({
    provider: {
      id: providerDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      lastSynced: data.club_last_synced?.toDate?.()?.toISOString() || data.club_last_synced || null,
    },
    signals,
    upgradeScore: Math.round(upgradeScore * 10) / 10,
    upgradeLevel,
    nextStep,
    trendingScore: Math.round(trendingScore * 10) / 10,
    isTrending,
  });
});

/* ── Email Trigger Check (non-blocking) ────────────────────── */

async function checkEmailTriggers(providerData, email) {
  if (!email) return;
  const sentFlags = providerData.emailTriggersSent || {};
  const views = providerData.views || 0;
  const disc = (providerData.clubData || {}).discussion_count || 0;
  const revs = (providerData.clubData || {}).review_count || 0;
  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerData.id || '');
  if (!providerData.id) return;

  const updates = {};

  if (views > 10 && !sentFlags.views_10) {
    await sendProviderEmail(email, 'People are finding your listing',
      `Your listing "${providerData.name || ''}" has been viewed over ${views} times. People are discovering your services on The Exchange.`);
    updates['emailTriggersSent.views_10'] = true;
  }

  if (disc > 0 && !sentFlags.first_discussion) {
    await sendProviderEmail(email, "You're being talked about",
      `People are discussing "${providerData.name || ''}" inside The Club. ${disc} discussion${disc !== 1 ? 's' : ''} and counting.`);
    updates['emailTriggersSent.first_discussion'] = true;
  }

  if (revs > 0 && !sentFlags.first_review) {
    await sendProviderEmail(email, 'New activity around your listing',
      `A review has been shared about "${providerData.name || ''}" inside The Club. See how people are responding.`);
    updates['emailTriggersSent.first_review'] = true;
  }

  // High-intent trigger: strong attention on a non-COMMUNITY listing
  const uScore = (views * 0.2) + (disc * 5) + (revs * 5);
  const uLevel = uScore > 50 ? 'HIGH' : uScore > 20 ? 'MEDIUM' : 'LOW';
  if (uLevel === 'HIGH' && (providerData.tier || '').toUpperCase() !== 'COMMUNITY' && !sentFlags.high_intent) {
    await sendProviderEmail(email, "You're getting strong attention right now",
      `Your listing "${providerData.name || ''}" is actively being viewed and engaged with. People are discovering your services — now is the time to join The Club and take control of the conversation.`);
    updates['emailTriggersSent.high_intent'] = true;
  }

  if (Object.keys(updates).length) {
    await providerRef.update(updates);
  }
}

/* ── Update Provider ───────────────────────────────────────── */

exports.providerUpdate = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'PUT') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).get();
  if (!accountDoc.exists || !accountDoc.data().providerId) {
    res.status(404).json({ error: 'No provider listing found.' }); return;
  }

  const providerId = accountDoc.data().providerId;
  const providerDoc = await db.collection(PROVIDERS_COLLECTION).doc(providerId).get();
  if (!providerDoc.exists) { res.status(404).json({ error: 'Listing not found.' }); return; }

  const existing = providerDoc.data();
  if (existing.claimedBy !== decoded.uid) {
    res.status(403).json({ error: 'You do not own this listing.' }); return;
  }

  const body = parseBody(req);
  const tier = (existing.tier || 'FREE').toUpperCase();
  const isPaid = tier !== 'FREE';
  const FREE_FIELDS = ['name', 'description'];
  const PAID_FIELDS = ['name', 'category', 'format', 'description', 'city', 'state', 'country', 'website', 'phone', 'tags', 'buyLink'];
  const ALLOWED_FIELDS = isPaid ? PAID_FIELDS : FREE_FIELDS;
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) {
      if (field === 'tags') {
        updates.tags = typeof body.tags === 'string'
          ? body.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
          : [];
      } else if (field === 'description') {
        updates.description = String(body.description || '').trim().slice(0, 2000);
      } else if (field === 'website' || field === 'buyLink') {
        updates[field] = String(body[field] || '').trim().slice(0, 500);
      } else {
        updates[field] = normalizeText(body[field]).slice(0, 200);
      }
    }
  }

  if (body.shippingCountries !== undefined) {
    updates.shippingCountries = Array.isArray(body.shippingCountries)
      ? body.shippingCountries.filter(v => typeof v === 'string').slice(0, 10)
      : [];
  }

  await db.collection(PROVIDERS_COLLECTION).doc(providerId).update(updates);
  res.status(200).json({
    success: true,
    postActionPrompt: 'Want to see how people are responding inside The Club?',
  });
});

/* ── Admin: Verify ─────────────────────────────────────────── */

exports.adminVerify = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const isAdmin = ADMIN_UIDS.has(decoded.uid);
  res.status(200).json({ isAdmin });
});

/* ── Admin: List Providers ─────────────────────────────────── */

exports.adminProviders = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const snapshot = await db.collection(PROVIDERS_COLLECTION).orderBy('createdAt', 'desc').get();
  const providers = [];
  const claimedByUids = new Set();

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.claimedBy) claimedByUids.add(data.claimedBy);
  });

  // Batch resolve claim user emails
  const uidToEmail = {};
  for (const uid of claimedByUids) {
    try {
      const userRecord = await admin.auth().getUser(uid);
      uidToEmail[uid] = userRecord.email || '';
    } catch { uidToEmail[uid] = ''; }
  }

  // Batch hydrate claim rows with the ORIGINAL Exchange listing so admins can
  // compare claimant info against the actual listing at review time.
  // Without this, reviewers had no way to tell "Corteiz claimed by
  // corteizspains@gmail.com" was a spam claim on an unrelated listing.
  const externalIds = new Set();
  snapshot.forEach(doc => {
    const d = doc.data();
    if (d.claimedBy && d.externalProviderId) externalIds.add(d.externalProviderId);
  });
  const extIdToListing = {};
  if (externalIds.size > 0) {
    const idList = Array.from(externalIds);
    // Firestore has no whereIn on doc IDs across arbitrary collections, so
    // fetch individually with Promise.all. Cap concurrency implicitly by the
    // number of pending claims — usually a handful.
    await Promise.all(idList.map(async (extId) => {
      try {
        const extDoc = await pcnDb.collection('pathway-providers').doc(extId).get();
        if (extDoc.exists) {
          const ed = extDoc.data() || {};
          extIdToListing[extId] = {
            website: ed.website || '',
            phone: ed.phone || '',
            location: ed.location || '',
            type: ed.type || '',
            businessName: ed.businessName || ed.name || '',
            verifiedByListing: ed.verified === true,
          };
        }
      } catch (err) {
        functions.logger.warn('Claim listing hydrate failed', { extId, error: err.message });
      }
    }));
  }

  snapshot.forEach(doc => {
    const data = doc.data();
    const views = data.views || 0;
    const disc = (data.clubData || {}).discussion_count || 0;
    const revs = (data.clubData || {}).review_count || 0;
    const uScore = (views * 0.2) + (disc * 5) + (revs * 5);
    const ext = data.externalProviderId ? extIdToListing[data.externalProviderId] : null;
    providers.push({
      id: doc.id,
      name: data.name || '',
      email: data.contactEmail || '',
      status: data.status || 'PENDING',
      tier: data.tier || 'FREE',
      category: data.category || '',
      city: data.city || '',
      state: data.state || '',
      slug: data.slug || '',
      upgradeScore: Math.round(uScore * 10) / 10,
      discussion_count: disc,
      review_count: revs,
      views,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      claimedBy: data.claimedBy || null,
      claimEmail: data.claimedBy ? (uidToEmail[data.claimedBy] || '') : '',
      claimRole: data.claimRole || '',
      claimPhone: data.claimPhone || '',
      claimRelevanceStatement: data.claimRelevanceStatement || '',
      claimVetting: data.claimVetting || null,
      externalProviderId: data.externalProviderId || '',
      // Original Exchange listing snapshot for admin vetting
      externalWebsite: ext ? ext.website : '',
      externalPhone: ext ? ext.phone : '',
      externalLocation: ext ? ext.location : '',
      externalType: ext ? ext.type : '',
      externalBusinessName: ext ? ext.businessName : '',
    });
  });

  res.status(200).json({ providers });
});

/* ── Admin: Approve ────────────────────────────────────────── */

exports.adminProviderApprove = onRequest({ secrets: ['MAILERSEND_API_KEY'] }, async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const { providerId } = parseBody(req);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  const data = doc.data();
  const approveUpdate = {
    status: 'APPROVED',
    verified: true,
    approved_at: Date.now(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // If $49 tier, boost ranking and trigger Club activation
  if ((data.tier || '').toUpperCase() === 'COMMUNITY') {
    approveUpdate.boostScore = 100;
    approveUpdate.clubActivatedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await providerRef.update(approveUpdate);

  // Sync verified + listingStatus back to the pathway-providers record (pcn---new project)
  const extId = data.externalProviderId;
  if (extId) {
    // Resolve the claimer's email so the club app can find the record
    let claimerEmail = '';
    if (data.claimedBy) {
      const acctDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(data.claimedBy).get();
      claimerEmail = acctDoc.exists ? (acctDoc.data().email || '') : '';
      if (!claimerEmail) {
        try { claimerEmail = (await admin.auth().getUser(data.claimedBy)).email || ''; } catch (e) { /* */ }
      }
    }
    try {
      const syncPayload = {
        verified: true,
        listingStatus: 'community_provider',
        claimedBy: data.claimedBy || null,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (claimerEmail) syncPayload.email = claimerEmail.toLowerCase();
      await pcnDb.collection('pathway-providers').doc(extId).update(syncPayload);
    } catch (syncErr) {
      functions.logger.warn('pathway-providers sync skipped (doc may not exist):', syncErr.message);
    }
  }

  // Send approval email + add to MailerLite group
  const ownerUid = data.claimedBy;
  if (ownerUid) {
    let accountEmail = '';
    const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(ownerUid).get();
    accountEmail = accountDoc.exists ? (accountDoc.data().email || '') : '';
    if (!accountEmail) {
      try { accountEmail = (await admin.auth().getUser(ownerUid)).email || ''; } catch (e) { /* user deleted */ }
    }
    if (accountEmail) {
      const approveSubject = 'Your listing is live! \ud83c\udf89';
      const approveText = `Great news! Your listing ${data.name || ''} has been approved and is now live on The Exchange.\n\nPeople living with Parkinson's and care partners can now discover you when they search for resources in the community.\n\nHere's what happens next:\n- Your listing is visible in Exchange search results\n- Community members can view your details, leave reviews, and start discussions\n- You can track views, clicks, and engagement from your dashboard\n\nThis is just the beginning. The more you engage, the more visible you become.\n\nView your dashboard: https://dolifetoday.com/provider-dashboard`;
      const approveHtml = buildProviderEmailHtml('Your listing is live! \ud83c\udf89', [
        `Great news! Your listing <strong>${data.name || ''}</strong> has been approved and is now live on The Exchange.`,
        'People living with Parkinson\'s and care partners can now discover you when they search for resources in the community.',
        '<strong>Here\'s what happens next:</strong>',
        '\u2022 Your listing is visible in Exchange search results<br>\u2022 Community members can view your details, leave reviews, and start discussions<br>\u2022 You can track views, clicks, and engagement from your dashboard',
        'This is just the beginning. The more you engage, the more visible you become.',
      ], { url: 'https://dolifetoday.com/provider-dashboard', label: '\ud83d\udc49 Go to Your Dashboard' });
      await sendProviderEmail(accountEmail, approveSubject, approveText, approveHtml);

      // Add to MailerLite Exchange Providers group
      const mlToken = getEnvValue('MAILERLITE_API_TOKEN');
      if (mlToken) {
        try {
          await fetch(MAILERLITE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mlToken}` },
            body: JSON.stringify({
              email: accountEmail,
              groups: ['181164512559236805'],
              fields: { provider_name: (data.name || '').slice(0, 200) },
            }),
          });
        } catch (mlErr) {
          functions.logger.error('MailerLite group add failed:', mlErr);
        }
      }
    }
  }

  res.status(200).json({ success: true, status: 'APPROVED' });
});

/* ── Admin: Reject ─────────────────────────────────────────── */

exports.adminProviderReject = onRequest({ secrets: ['MAILERSEND_API_KEY'] }, async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const { providerId, reason } = parseBody(req);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }
  if (!reason || reason.trim().length < 5) {
    res.status(400).json({ error: 'A rejection reason is required.' }); return;
  }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  const data = doc.data();
  await providerRef.update({
    status: 'REJECTED',
    verified: false,
    rejectionReason: reason.trim().slice(0, 500),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Sync verified=false back to the pathway-providers record (pcn---new project)
  const extId = data.externalProviderId;
  if (extId) {
    try {
      await pcnDb.collection('pathway-providers').doc(extId).update({
        verified: false,
        listingStatus: 'unclaimed',
      });
    } catch (syncErr) {
      functions.logger.warn('pathway-providers reject sync skipped:', syncErr.message);
    }
  }

  const ownerUid = data.claimedBy;
  if (ownerUid) {
    let accountEmail = '';
    const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(ownerUid).get();
    accountEmail = accountDoc.exists ? (accountDoc.data().email || '') : '';
    if (!accountEmail) {
      try { accountEmail = (await admin.auth().getUser(ownerUid)).email || ''; } catch (e) { /* user deleted */ }
    }
    if (accountEmail) {
      const rejectSubject = 'Almost there \u2014 your listing needs a quick update';
      const rejectText = `Your listing ${data.name || ''} is close, but it needs a small update before it can go live on The Exchange.\n\nHere's what we noticed:\n${reason.trim()}\n\nNo worries - just head to your dashboard, make the update, and we'll review it again right away.\n\nWe want to make sure every listing on The Exchange is helpful and accurate for the Parkinson's community. Thanks for being part of it.\n\nUpdate your listing: https://dolifetoday.com/provider-dashboard`;
      const rejectHtml = buildProviderEmailHtml('Almost there \u2014 your listing needs a quick update', [
        `Your listing <strong>${data.name || ''}</strong> is close, but it needs a small update before it can go live on The Exchange.`,
        `<strong>Here\'s what we noticed:</strong><br>${reason.trim()}`,
        'No worries \u2014 just head to your dashboard, make the update, and we\'ll review it again right away.',
        'We want to make sure every listing on The Exchange is helpful and accurate for the Parkinson\'s community. Thanks for being part of it.',
      ], { url: 'https://dolifetoday.com/provider-dashboard', label: '\ud83d\udc49 Update Your Listing' });
      await sendProviderEmail(accountEmail, rejectSubject, rejectText, rejectHtml);
    }
  }

  res.status(200).json({ success: true, status: 'REJECTED' });
});

/* ── Admin: Flag ───────────────────────────────────────────── */

exports.adminProviderFlag = onRequest({ secrets: ['MAILERSEND_API_KEY'] }, async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const { providerId } = parseBody(req);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  const data = doc.data();
  await providerRef.update({
    status: 'FLAGGED',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify the provider their listing has been paused
  const ownerUid = data.claimedBy;
  if (ownerUid) {
    let accountEmail = '';
    const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(ownerUid).get();
    accountEmail = accountDoc.exists ? (accountDoc.data().email || '') : '';
    if (!accountEmail) {
      try { accountEmail = (await admin.auth().getUser(ownerUid)).email || ''; } catch (e) { /* user deleted */ }
    }
    if (accountEmail) {
      const flagSubject = 'Your listing has been paused \u23f8\ufe0f';
      const flagText = `Just a heads up - your listing ${data.name || ''} on The Exchange has been temporarily paused.\n\nThis means it's not currently visible in search results. This can happen when a listing needs verification or a quick update.\n\nIf you think this was a mistake, or if you have any questions, just reply to this email and we'll sort it out.\n\nWe appreciate you being part of The Exchange and the Doing Life Today community.\n\nView your dashboard: https://dolifetoday.com/provider-dashboard`;
      const flagHtml = buildProviderEmailHtml('Your listing has been paused \u23f8\ufe0f', [
        `Just a heads up \u2014 your listing <strong>${data.name || ''}</strong> on The Exchange has been temporarily paused.`,
        'This means it\'s not currently visible in search results. This can happen when a listing needs verification or a quick update.',
        'If you think this was a mistake, or if you have any questions, just reply to this email and we\'ll sort it out.',
        'We appreciate you being part of The Exchange and the <strong>Doing Life Today</strong> community.',
      ], { url: 'https://dolifetoday.com/provider-dashboard', label: '\ud83d\udc49 View Your Dashboard' });
      await sendProviderEmail(accountEmail, flagSubject, flagText, flagHtml);
    }
  }

  res.status(200).json({ success: true, status: 'FLAGGED' });
});

/* ── Admin: Add Provider ───────────────────────────────────── */

exports.adminProviderAdd = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const body = parseBody(req);
  const name = normalizeText(body.name);
  if (!name || name.length < 2) {
    res.status(400).json({ error: 'Provider name is required.' }); return;
  }

  const tier = ['FREE', 'VERIFIED', 'COMMUNITY'].includes((body.tier || '').toUpperCase())
    ? body.tier.toUpperCase()
    : 'FREE';

  const slug = slugify(name) + '-' + Date.now().toString(36);

  const providerDoc = {
    name,
    slug,
    category: normalizeText(body.category) || 'other',
    format: normalizeText(body.format) || 'in-person',
    city: normalizeText(body.city),
    state: normalizeText(body.state),
    country: normalizeText(body.country),
    description: (body.description || '').trim().slice(0, 2000),
    website: (body.website || '').trim().slice(0, 500),
    buyLink: (body.buyLink || '').trim().slice(0, 500),
    phone: (body.phone || '').trim().slice(0, 50),
    contactEmail: (body.contactEmail || '').trim().slice(0, 200),
    language: normalizeText(body.language) || 'English',
    tags: typeof body.tags === 'string'
      ? body.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
      : [],
    shippingCountries: Array.isArray(body.shippingCountries)
      ? body.shippingCountries.filter(v => typeof v === 'string').slice(0, 10)
      : [],
    status: 'APPROVED',
    tier,
    views: 0,
    clicks: 0,
    searchAppearances: 0,
    clubData: { discussion_count: 0, review_count: 0, club_views: 0 },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection(PROVIDERS_COLLECTION).add(providerDoc);
  res.status(201).json({ success: true, id: docRef.id, slug, tier });
});

/* ── Admin: Edit Provider ──────────────────────────────────── */

exports.adminProviderEdit = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const body = parseBody(req);
  const providerId = normalizeText(body.providerId);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  const ALLOWED = ['name', 'category', 'format', 'description', 'city', 'state', 'country', 'website', 'phone', 'contactEmail', 'language', 'tags', 'buyLink'];
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  for (const field of ALLOWED) {
    if (body[field] !== undefined) {
      if (field === 'tags') {
        updates.tags = typeof body.tags === 'string'
          ? body.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
          : [];
      } else if (field === 'description') {
        updates.description = String(body.description || '').trim().slice(0, 2000);
      } else if (field === 'website' || field === 'buyLink') {
        updates[field] = String(body[field] || '').trim().slice(0, 500);
      } else {
        updates[field] = normalizeText(body[field]).slice(0, 200);
      }
    }
  }

  if (body.shippingCountries !== undefined) {
    updates.shippingCountries = Array.isArray(body.shippingCountries)
      ? body.shippingCountries.filter(v => typeof v === 'string').slice(0, 10)
      : [];
  }

  await providerRef.update(updates);
  res.status(200).json({ success: true });
});

/* ── Admin: Delete Provider ────────────────────────────────── */

exports.adminProviderDelete = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const { providerId } = parseBody(req);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  await providerRef.delete();
  res.status(200).json({ success: true });
});

/* ── Admin: Set Tier ───────────────────────────────────────── */

exports.adminProviderSetTier = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const { providerId, tier } = parseBody(req);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

  const validTier = ['FREE', 'VERIFIED', 'COMMUNITY'].includes((tier || '').toUpperCase())
    ? tier.toUpperCase()
    : null;
  if (!validTier) { res.status(400).json({ error: 'Tier must be FREE, VERIFIED, or COMMUNITY.' }); return; }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  const updates = {
    tier: validTier,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (validTier === 'COMMUNITY') {
    updates.boostScore = 100;
    updates.clubActivatedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await providerRef.update(updates);
  res.status(200).json({ success: true, tier: validTier });
});

/* ════════════════════════════════════════════════════════════════
   STRIPE — Provider subscriptions ($9 Verified, $49 Club Partner)
   ════════════════════════════════════════════════════════════════ */

let _stripeClient = null;
function getStripe() {
  if (_stripeClient) return _stripeClient;
  const key = getEnvValue('STRIPE_SECRET_KEY');
  if (!key) return null;
  // eslint-disable-next-line global-require
  _stripeClient = require('stripe')(key, { apiVersion: '2024-06-20' });
  return _stripeClient;
}

const STRIPE_TIER_BY_PRICE = () => ({
  [getEnvValue('STRIPE_PRICE_VERIFIED') || '']: 'VERIFIED',
  [getEnvValue('STRIPE_PRICE_COMMUNITY') || '']: 'COMMUNITY',
});

function tierForPriceId(priceId) {
  const map = STRIPE_TIER_BY_PRICE();
  return map[priceId] || null;
}

/* ── providerCheckoutSession ──────────────────────────────────
   POST { tier: 'VERIFIED' | 'COMMUNITY' }  (Bearer auth required)
   Returns { url } — redirect provider to Stripe Checkout.
   ─────────────────────────────────────────────────────────── */
exports.providerCheckoutSession = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const stripe = getStripe();
  if (!stripe) { res.status(500).json({ error: 'Stripe is not configured.' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const { tier } = parseBody(req);
  const targetTier = (tier || '').toUpperCase();
  if (!['VERIFIED', 'COMMUNITY'].includes(targetTier)) {
    res.status(400).json({ error: 'Tier must be VERIFIED or COMMUNITY.' }); return;
  }

  const priceId = targetTier === 'VERIFIED'
    ? getEnvValue('STRIPE_PRICE_VERIFIED')
    : getEnvValue('STRIPE_PRICE_COMMUNITY');
  if (!priceId) { res.status(500).json({ error: `Stripe price for ${targetTier} not configured.` }); return; }

  // Look up provider for this account
  const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).get();
  if (!accountDoc.exists || !accountDoc.data().providerId) {
    res.status(404).json({ error: 'No provider listing found.' }); return;
  }
  const providerId = accountDoc.data().providerId;
  const providerDoc = await db.collection(PROVIDERS_COLLECTION).doc(providerId).get();
  if (!providerDoc.exists) { res.status(404).json({ error: 'Provider listing not found.' }); return; }
  const providerData = providerDoc.data();

  const successUrl = 'https://dolifetoday.com/provider-dashboard?upgraded=true&tier=' + targetTier;
  const cancelUrl = 'https://dolifetoday.com/provider-dashboard?upgrade=cancelled';

  try {
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: providerId,
      metadata: { providerId, targetTier, accountUid: decoded.uid },
      subscription_data: {
        metadata: { providerId, targetTier, accountUid: decoded.uid },
      },
      allow_promotion_codes: true,
    };
    if (providerData.stripeCustomerId) {
      sessionParams.customer = providerData.stripeCustomerId;
    } else if (decoded.email) {
      sessionParams.customer_email = decoded.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    functions.logger.error('Stripe checkout session error:', err);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

/* ── stripeWebhook ──────────────────────────────────────────
   Handles checkout.session.completed and subscription lifecycle.
   Stripe must POST to /api/stripe/webhook with the signing secret.
   ─────────────────────────────────────────────────────────── */
exports.stripeWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const stripe = getStripe();
  const webhookSecret = getEnvValue('STRIPE_WEBHOOK_SECRET');
  if (!stripe || !webhookSecret) {
    functions.logger.error('Stripe webhook not configured (missing secret key or webhook secret).');
    res.status(500).send('Stripe not configured.');
    return;
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    // Firebase 2nd gen onRequest exposes the raw body buffer at req.rawBody
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    functions.logger.warn('Stripe webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(stripe, session);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await handleSubscriptionChange(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await handleSubscriptionDeleted(sub);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }
      default:
        // Unhandled event type — ack
        break;
    }
    res.status(200).json({ received: true });
  } catch (err) {
    functions.logger.error('Stripe webhook handler error:', err);
    res.status(500).send('Webhook handler failed.');
  }
});

/**
 * COMMUNITY-tier provisioning handoff to The Club (pcn---new).
 *
 * Writes a `partner-club-provisioning/{providerId}` doc that the pcn
 * side's `provisionCommunityPartnerClub` Firestore trigger picks up to:
 *   1. create or lookup the partner's Firebase Auth account,
 *   2. create the Partner Club (community-groups doc, isPartnerClub: true),
 *   3. mint a 60-day welcome token + email the partner,
 *   4. write back `partnerClubId` + status here for observability.
 *
 * Idempotent: the pcn trigger no-ops if `status !== 'pending'`. We always
 * overwrite the pending payload so a repeat Stripe webhook (e.g. after a
 * failed run) still delivers fresh data.
 */
async function enqueuePartnerClubProvisioning({ providerId, session, subscription }) {
  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const providerDoc = await providerRef.get();
  if (!providerDoc.exists) {
    functions.logger.warn('enqueuePartnerClubProvisioning: provider missing', { providerId });
    return;
  }
  const pData = providerDoc.data() || {};
  const slug = pData.slug || providerId;
  const partnerEmail = (
    (session.customer_details && session.customer_details.email)
    || pData.contactEmail
    || pData.email
    || ''
  ).trim().toLowerCase();
  const partnerName = (
    (session.customer_details && session.customer_details.name)
    || pData.contactName
    || pData.name
    || ''
  ).trim();

  if (!partnerEmail) {
    functions.logger.error('enqueuePartnerClubProvisioning: no email available', {
      providerId, sessionId: session.id,
    });
    return;
  }

  await pcnDb.collection('partner-club-provisioning').doc(providerId).set({
    providerId,
    providerSlug: slug,
    providerName: pData.name || partnerName || 'Community Partner',
    providerDescription: pData.description || '',
    providerCategory: pData.category || null,
    providerCity: pData.city || null,
    providerState: pData.state || null,
    providerCountry: pData.country || null,
    providerWebsite: pData.website || null,
    providerLogo: pData.logo || pData.image || null,
    partnerEmail,
    partnerName: partnerName || pData.name || 'Community Partner',
    stripeCustomerId: session.customer || null,
    stripeSubscriptionId: session.subscription || null,
    stripeSessionId: session.id || null,
    stripePriceId: (subscription && subscription.items.data[0] ? subscription.items.data[0].price.id : null),
    status: 'pending',
    attempts: admin.firestore.FieldValue.increment(1),
    lastEnqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  functions.logger.info('Partner Club provisioning enqueued', { providerId, partnerEmail });
}

async function handleCheckoutCompleted(stripe, session) {
  const providerId = session.client_reference_id || (session.metadata && session.metadata.providerId);
  if (!providerId) {
    functions.logger.warn('Stripe checkout.session.completed missing providerId', { sessionId: session.id });
    return;
  }

  // Fetch full subscription to get price + status
  let subscription = null;
  if (session.subscription) {
    subscription = await stripe.subscriptions.retrieve(session.subscription);
  }
  const priceId = subscription && subscription.items.data[0] ? subscription.items.data[0].price.id : null;
  const tier = tierForPriceId(priceId) || (session.metadata && session.metadata.targetTier) || 'VERIFIED';

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const updates = {
    tier,
    stripeCustomerId: session.customer || null,
    stripeSubscriptionId: session.subscription || null,
    stripePriceId: priceId,
    stripeSubscriptionStatus: subscription ? subscription.status : 'active',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (tier === 'COMMUNITY') {
    updates.boostScore = 100;
    updates.clubActivatedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await providerRef.set(updates, { merge: true });

  // Sync verified flag to pcn---new pathway-providers
  try {
    const providerDoc = await providerRef.get();
    const slug = providerDoc.data() && providerDoc.data().slug;
    if (slug) {
      await pcnDb.collection('pathway-providers').doc(slug).set({
        verified: true,
        tier,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch (err) {
    functions.logger.warn('Cross-project sync after Stripe upgrade failed:', err.message);
  }

  // COMMUNITY tier: enqueue Partner Club provisioning in The Club so the
  // paying business gets a walled Club, a partner account, and a welcome
  // email. The pcn side runs `provisionCommunityPartnerClub` on this doc.
  if (tier === 'COMMUNITY') {
    try {
      await enqueuePartnerClubProvisioning({
        providerId,
        session,
        subscription,
      });
    } catch (err) {
      functions.logger.error('Failed to enqueue Partner Club provisioning:', err.message);
    }
  }

  // Notify admin
  try {
    const adminEmail = getEnvValue('ADMIN_NOTIFY_EMAIL');
    const providerDoc = await providerRef.get();
    const pData = providerDoc.data() || {};
    if (adminEmail) {
      const subj = `💳 New ${tier} subscription: ${pData.name || providerId}`;
      const body = `A provider just upgraded.\n\nProvider: ${pData.name || '(unknown)'}\nTier: ${tier}\nID: ${providerId}\nCustomer: ${session.customer}\nSubscription: ${session.subscription}\n\nAdmin: https://dolifetoday.com/admin-providers`;
      await sendProviderEmail(adminEmail, subj, body, body.replace(/\n/g, '<br>'));
    }
  } catch (err) {
    functions.logger.warn('Admin notify after Stripe upgrade failed:', err.message);
  }
}

async function handleSubscriptionChange(sub) {
  const providerId = sub.metadata && sub.metadata.providerId;
  if (!providerId) return;
  const priceId = sub.items.data[0] ? sub.items.data[0].price.id : null;
  const tier = tierForPriceId(priceId);

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const updates = {
    stripeSubscriptionStatus: sub.status,
    stripePriceId: priceId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  // If subscription is active and tier changed, apply it
  if (tier && (sub.status === 'active' || sub.status === 'trialing')) {
    updates.tier = tier;
    if (tier === 'COMMUNITY') {
      updates.boostScore = 100;
      updates.clubActivatedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }
  // If subscription is past_due / unpaid / cancelled, downgrade to FREE
  if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
    updates.tier = 'FREE';
    updates.boostScore = 0;
  }
  await providerRef.set(updates, { merge: true });
}

async function handleSubscriptionDeleted(sub) {
  const providerId = sub.metadata && sub.metadata.providerId;
  if (!providerId) return;
  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  await providerRef.set({
    tier: 'FREE',
    boostScore: 0,
    stripeSubscriptionStatus: 'canceled',
    canceledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Sync downgrade to pcn---new
  try {
    const providerDoc = await providerRef.get();
    const slug = providerDoc.data() && providerDoc.data().slug;
    if (slug) {
      await pcnDb.collection('pathway-providers').doc(slug).set({
        verified: false,
        tier: 'FREE',
      }, { merge: true });
    }
  } catch (err) {
    functions.logger.warn('Cross-project sync after Stripe cancel failed:', err.message);
  }
}

async function handlePaymentFailed(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subId);
  const providerId = sub.metadata && sub.metadata.providerId;
  if (!providerId) return;
  await db.collection(PROVIDERS_COLLECTION).doc(providerId).set({
    stripeSubscriptionStatus: sub.status,
    paymentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/* ── providerBillingPortal ──────────────────────────────────
   POST (Bearer auth required) — returns Stripe Customer Portal URL
   so providers can manage/cancel their subscription.
   ─────────────────────────────────────────────────────────── */
exports.providerBillingPortal = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const stripe = getStripe();
  if (!stripe) { res.status(500).json({ error: 'Stripe is not configured.' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).get();
  if (!accountDoc.exists || !accountDoc.data().providerId) {
    res.status(404).json({ error: 'No provider listing found.' }); return;
  }
  const providerId = accountDoc.data().providerId;
  const providerDoc = await db.collection(PROVIDERS_COLLECTION).doc(providerId).get();
  const customerId = providerDoc.data() && providerDoc.data().stripeCustomerId;
  if (!customerId) { res.status(400).json({ error: 'No active subscription found.' }); return; }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://dolifetoday.com/provider-dashboard',
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    functions.logger.error('Stripe billing portal error:', err);
    res.status(500).json({ error: 'Could not create billing portal session.' });
  }
});

/* ── Club Sync Layer — Expose limited metrics ──────────────── */

exports.providerClubSync = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  if (req.method === 'GET') {
    // Public: get sync data for a provider
    const providerId = normalizeText(req.query?.providerId);
    if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

    const doc = await db.collection(PROVIDERS_COLLECTION).doc(providerId).get();
    if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

    const data = doc.data();
    // Only expose limited metrics — never actual content
    res.status(200).json({
      providerId: doc.id,
      status: data.status,
      tier: data.tier,
      discussion_count: data.clubData?.discussion_count || 0,
      review_count: data.clubData?.review_count || 0,
      club_views: data.clubData?.club_views || 0,
    });
    return;
  }

  if (req.method === 'POST') {
    // Club app posts updated metrics (requires shared secret)
    const syncSecret = getEnvValue('CLUB_SYNC_SECRET');
    if (!syncSecret) { res.status(500).json({ error: 'Sync not configured.' }); return; }

    const providedSecret = (req.headers['x-sync-secret'] || '').trim();
    if (!secretsMatch(providedSecret, syncSecret)) {
      res.status(403).json({ error: 'Invalid sync secret.' }); return;
    }

    const { providerId, discussion_count, review_count, club_views } = parseBody(req);
    if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

    const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
    const doc = await providerRef.get();
    if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

    await providerRef.update({
      'clubData.discussion_count': typeof discussion_count === 'number' ? Math.max(0, discussion_count) : 0,
      'clubData.review_count': typeof review_count === 'number' ? Math.max(0, review_count) : 0,
      'clubData.club_views': typeof club_views === 'number' ? Math.max(0, club_views) : 0,
      club_last_synced: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ success: true, club_last_synced: Date.now() });
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
});

/* ── Analytics: Track Event ────────────────────────────────── */

const ANALYTICS_COLLECTION = 'analytics_events';
const ANALYTICS_SUMMARY_COLLECTION = 'analytics_summary_daily';

exports.trackEvent = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  const body = parseBody(req);
  const eventName = (body.eventName || '').trim().slice(0, 100);
  if (!eventName) { res.status(400).json({ error: 'eventName is required.' }); return; }

  const providerId = decoded ? (await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(decoded.uid).get()).data()?.providerId || null : null;
  let tier = body.tier || null;

  if (providerId && !tier) {
    const pDoc = await db.collection(PROVIDERS_COLLECTION).doc(providerId).get();
    if (pDoc.exists) tier = pDoc.data().tier || 'FREE';
  }

  const payload = {};
  const allowedKeys = ['targetTier', 'source', 'page'];
  for (const k of allowedKeys) {
    if (body[k] !== undefined) payload[k] = String(body[k]).slice(0, 200);
  }

  await db.collection(ANALYTICS_COLLECTION).add({
    eventName,
    provider_id: providerId,
    tier: tier || null,
    timestamp: Date.now(),
    ...payload,
  });

  res.status(200).json({ success: true });
});

/* ── Admin: High Intent Providers ──────────────────────────── */

exports.adminHighIntent = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const snap = await db.collection(PROVIDERS_COLLECTION).get();
  const highIntent = [];

  snap.forEach(doc => {
    const d = doc.data();
    const views = d.views || 0;
    const disc = (d.clubData || {}).discussion_count || 0;
    const revs = (d.clubData || {}).review_count || 0;
    const upgradeScore = (views * 0.2) + (disc * 5) + (revs * 5);
    const tier = (d.tier || 'FREE').toUpperCase();

    if (upgradeScore > 30 && tier !== 'COMMUNITY') {
      highIntent.push({
        id: doc.id,
        name: d.name || '',
        email: d.contactEmail || '',
        tier,
        upgradeScore: Math.round(upgradeScore * 10) / 10,
        views,
        discussion_count: disc,
        review_count: revs,
        reminderSent: !!(d.emailTriggersSent || {}).high_intent_manual,
      });
    }
  });

  highIntent.sort((a, b) => b.upgradeScore - a.upgradeScore);

  res.status(200).json({ providers: highIntent });
});

/* ── Admin: Send Reminder Email ────────────────────────────── */

exports.adminSendReminder = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const { providerId } = parseBody(req);
  if (!providerId) { res.status(400).json({ error: 'Provider ID is required.' }); return; }

  const providerRef = db.collection(PROVIDERS_COLLECTION).doc(providerId);
  const doc = await providerRef.get();
  if (!doc.exists) { res.status(404).json({ error: 'Provider not found.' }); return; }

  const data = doc.data();
  const sentFlags = data.emailTriggersSent || {};

  if (sentFlags.high_intent_manual) {
    res.status(409).json({ error: 'Reminder already sent to this provider.' }); return;
  }

  // Resolve provider email — look up the claiming account if contactEmail is empty
  let email = (data.contactEmail || '').trim();
  if (!email && data.claimedBy) {
    try {
      const userRecord = await admin.auth().getUser(data.claimedBy);
      email = userRecord.email || '';
    } catch { /* ignore */ }
  }

  if (!email) {
    res.status(400).json({ error: 'No email address found for this provider.' }); return;
  }

  await sendProviderEmail(email,
    'Your listing is getting attention right now',
    `We're seeing activity around your listing "${data.name || ''}" — views, engagement, and interest.\n\nJust wanted to make sure you're seeing what's happening inside The Club.`
  );

  await providerRef.update({ 'emailTriggersSent.high_intent_manual': true });

  res.status(200).json({ success: true });
});

/* ── Admin: Conversion Metrics ─────────────────────────────── */

exports.adminConversionMetrics = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const snap = await db.collection(PROVIDERS_COLLECTION).get();
  let total = 0, freeCount = 0, verifiedCount = 0, communityCount = 0;

  snap.forEach(doc => {
    total++;
    const tier = (doc.data().tier || 'FREE').toUpperCase();
    if (tier === 'COMMUNITY') communityCount++;
    else if (tier === 'VERIFIED') verifiedCount++;
    else freeCount++;
  });

  const upgradeRate = verifiedCount > 0
    ? Math.round((communityCount / verifiedCount) * 1000) / 10
    : 0;

  // Store daily snapshot
  const dateKey = new Date().toISOString().slice(0, 10);
  await db.collection(ANALYTICS_SUMMARY_COLLECTION).doc(dateKey).set({
    date: dateKey,
    total_providers: total,
    free_count: freeCount,
    verified_count: verifiedCount,
    community_count: communityCount,
    upgrade_rate: upgradeRate,
    updated_at: Date.now(),
  }, { merge: true });

  res.status(200).json({
    total_providers: total,
    free_count: freeCount,
    verified_count: verifiedCount,
    community_count: communityCount,
    upgrade_rate: upgradeRate,
  });
});

/* ── Admin: Owner Dashboard Snapshot ───────────────────────── */

exports.adminOwnerDashboard = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const TRENDING_THRESHOLD = 15;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  // Parallel: providers snapshot + today's analytics events
  const [providersSnap, eventsSnap] = await Promise.all([
    db.collection(PROVIDERS_COLLECTION).get(),
    db.collection(ANALYTICS_COLLECTION).where('timestamp', '>=', todayMs).get(),
  ]);

  // --- Provider aggregates ---
  let freeCount = 0, verifiedCount = 0, communityCount = 0;
  let pendingCount = 0, highIntentCount = 0, trendingCount = 0;
  const trending = [];

  providersSnap.forEach(doc => {
    const d = doc.data();
    const tier = (d.tier || 'FREE').toUpperCase();
    const views = d.views || 0;
    const disc = (d.clubData || {}).discussion_count || 0;
    const revs = (d.clubData || {}).review_count || 0;
    const upgradeScore = (views * 0.2) + (disc * 5) + (revs * 5);
    const trendingScore = (views * 1) + (disc * 5) + (revs * 5) + (d.boostScore || 0);

    if (tier === 'COMMUNITY') communityCount++;
    else if (tier === 'VERIFIED') verifiedCount++;
    else freeCount++;

    if ((d.status || '').toUpperCase() === 'PENDING') pendingCount++;
    if (upgradeScore > 30 && tier !== 'COMMUNITY') highIntentCount++;
    if (trendingScore > TRENDING_THRESHOLD) {
      trendingCount++;
      trending.push({
        id: doc.id,
        name: d.name || '',
        slug: d.slug || '',
        tier,
        trendingScore: Math.round(trendingScore * 10) / 10,
        views,
        discussion_count: disc,
        review_count: revs,
      });
    }
  });

  trending.sort((a, b) => b.trendingScore - a.trendingScore);
  const trendingTop10 = trending.slice(0, 10);

  const total = freeCount + verifiedCount + communityCount;
  const upgradeRate = verifiedCount > 0
    ? Math.round((communityCount / verifiedCount) * 1000) / 10
    : 0;

  // --- Today's analytics ---
  let claimsToday = 0, upgradesToday = 0;
  const recentEvents = [];

  eventsSnap.forEach(doc => {
    const ev = doc.data();
    const name = ev.eventName || '';
    if (name === 'claim_listing_clicked') claimsToday++;
    if (name === 'upgrade_completed') upgradesToday++;
    recentEvents.push({
      eventName: name,
      provider_id: ev.provider_id || null,
      tier: ev.tier || null,
      timestamp: ev.timestamp || 0,
    });
  });

  // Also count providerCreate + providerClaim docs created today
  const providerClaimsToday = [];
  providersSnap.forEach(doc => {
    const d = doc.data();
    const created = d.createdAt?.toDate?.()?.getTime() || 0;
    if (created >= todayMs) providerClaimsToday.push(d.name || 'Unnamed');
  });

  recentEvents.sort((a, b) => b.timestamp - a.timestamp);
  const recent20 = recentEvents.slice(0, 20);

  res.status(200).json({
    snapshot: {
      newClaimsToday: providerClaimsToday.length,
      upgradesToday,
      upgradeRate,
      highIntentCount,
      pendingCount,
      trendingCount,
    },
    funnel: {
      total_providers: total,
      free_count: freeCount,
      verified_count: verifiedCount,
      community_count: communityCount,
      upgrade_rate: upgradeRate,
    },
    trending: trendingTop10,
    recentEvents: recent20,
  });
});

/* ── Suggest Provider Edit (public, no auth) ───────────────── */

const SUGGEST_EDIT_COLLECTION = 'provider_edit_suggestions';
const SUGGEST_EDIT_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SUGGEST_EDIT_MAX_PER_WINDOW = 10;

exports.suggestProviderEdit = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16);

  // Rate limit by hashed IP using a dedicated rate-limit doc
  const rateLimitRef = db.collection(SUGGEST_EDIT_COLLECTION).doc('_rate_' + ipHash);
  const rateLimitDoc = await rateLimitRef.get();
  const now = Date.now();

  if (rateLimitDoc.exists) {
    const data = rateLimitDoc.data();
    const windowStart = data.windowStart || 0;
    const count = data.count || 0;

    if (now - windowStart < SUGGEST_EDIT_RATE_WINDOW_MS && count >= SUGGEST_EDIT_MAX_PER_WINDOW) {
      res.status(429).json({ error: 'Too many suggestions. Please try again later.' });
      return;
    }

    if (now - windowStart >= SUGGEST_EDIT_RATE_WINDOW_MS) {
      await rateLimitRef.set({ windowStart: now, count: 1 });
    } else {
      await rateLimitRef.update({ count: admin.firestore.FieldValue.increment(1) });
    }
  } else {
    await rateLimitRef.set({ windowStart: now, count: 1 });
  }

  const body = parseBody(req);
  const providerId = String(body.providerId || '').trim();
  const providerSlug = String(body.providerSlug || '').trim();

  if (!providerId && !providerSlug) {
    res.status(400).json({ error: 'Provider ID or slug is required.' });
    return;
  }

  const ALLOWED_FIELDS = ['name', 'city', 'state', 'description'];
  const edits = {};
  let hasEdit = false;

  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined && body[field] !== null) {
      const value = String(body[field]).trim();
      if (value) {
        edits[field] = field === 'description' ? value.slice(0, 2000) : value.slice(0, 200);
        hasEdit = true;
      }
    }
  }

  if (!hasEdit) {
    res.status(400).json({ error: 'At least one field to edit is required.' });
    return;
  }

  await db.collection(SUGGEST_EDIT_COLLECTION).add({
    providerId: providerId || null,
    providerSlug: providerSlug || null,
    edits,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(200).json({ success: true, message: 'Thank you! Your suggestion has been submitted for review.' });
});

/* ═══════════════════════════════════════════════════════════════
   ANALYTICS DASHBOARD — GA4 Data API
   ═══════════════════════════════════════════════════════════════ */

const { BetaAnalyticsDataClient } = require('@google-analytics/data');

exports.analyticsReport = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID;
  if (!GA_PROPERTY_ID) {
    res.status(500).json({ error: 'GA_PROPERTY_ID not configured.' }); return;
  }

  const range = req.query.range || '30';
  const validRanges = { '1': 'today', '7': '7daysAgo', '30': '30daysAgo', '90': '90daysAgo', '365': '365daysAgo' };
  const startDate = validRanges[range] || '30daysAgo';

  const client = new BetaAnalyticsDataClient();
  const property = `properties/${GA_PROPERTY_ID}`;

  try {
    // Run all reports in parallel
    const [overviewRes, pagesRes, sourcesRes, sourceDetailRes, devicesRes, countriesRes, dailyRes] = await Promise.all([
      // Overview metrics
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'engagedSessions' },
        ],
      }),
      // Top pages
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 200,
      }),
      // Traffic sources
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      }),
      // Detailed sources (channel + source + medium)
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [
          { name: 'sessionDefaultChannelGroup' },
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 100,
      }),
      // Devices
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
      // Countries
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      }),
      // Daily trend
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'totalUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      }),
    ]);

    function extractRow(report) {
      // runReport returns [response, request] — response is the report
      const data = Array.isArray(report) ? report[0] : report;
      const row = data?.rows?.[0];
      if (!row) return {};
      const out = {};
      (data.metricHeaders || []).forEach((h, i) => {
        out[h.name] = row.metricValues[i]?.value || '0';
      });
      return out;
    }

    function extractTable(report) {
      const data = Array.isArray(report) ? report[0] : report;
      const rows = data?.rows || [];
      const dims = (data?.dimensionHeaders || []).map(h => h.name);
      const mets = (data?.metricHeaders || []).map(h => h.name);
      return rows.map(r => {
        const obj = {};
        dims.forEach((d, i) => { obj[d] = r.dimensionValues[i]?.value || ''; });
        mets.forEach((m, i) => { obj[m] = r.metricValues[i]?.value || '0'; });
        return obj;
      });
    }

    res.status(200).json({
      range: range + 'd',
      overview: extractRow(overviewRes),
      pages: extractTable(pagesRes),
      sources: extractTable(sourcesRes),
      sourceDetail: extractTable(sourceDetailRes),
      devices: extractTable(devicesRes),
      countries: extractTable(countriesRes),
      daily: extractTable(dailyRes),
    });
  } catch (err) {
    console.error('Analytics API error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics data.', detail: err.message });
  }
});

/* ── Analytics: Custom Events Summary ──────────────────────── */

exports.analyticsEvents = onRequest(async (req, res) => {
  setCorsHeaders(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded || !ADMIN_UIDS.has(decoded.uid)) {
    res.status(403).json({ error: 'Admin access required.' }); return;
  }

  const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID;
  if (!GA_PROPERTY_ID) {
    res.status(500).json({ error: 'GA_PROPERTY_ID not configured.' }); return;
  }

  const range = req.query.range || '30';
  const validRanges = { '1': 'today', '7': '7daysAgo', '30': '30daysAgo', '90': '90daysAgo', '365': '365daysAgo' };
  const startDate = validRanges[range] || '30daysAgo';

  const client = new BetaAnalyticsDataClient();
  const property = `properties/${GA_PROPERTY_ID}`;

  try {
    const [eventsRes] = await client.runReport({
      property,
      dateRanges: [{ startDate, endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['scroll_depth', 'cta_click', 'outbound_click', 'file_download', 'form_submit', 'video_play', 'video_complete', 'engagement_time'],
          },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    });

    const rows = eventsRes?.rows || [];
    const events = rows.map(r => ({
      event: r.dimensionValues[0]?.value || '',
      count: r.metricValues[0]?.value || '0',
      users: r.metricValues[1]?.value || '0',
    }));

    // Top CTAs — requires custom dimensions to be registered in GA4
    // (Admin → Custom definitions → Custom dimensions → parameter=cta_text,
    // scope=Event; same for page_path). Until then the Data API returns a
    // "field ... not found" error which we surface as ctaStatus.
    let ctas = [];
    let ctaStatus = 'ok';
    try {
      const [ctaRes] = await client.runReport({
        property,
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'customEvent:cta_text' }, { name: 'customEvent:page_path' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { value: 'cta_click', matchType: 'EXACT' },
          },
        },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 30,
      });
      ctas = (ctaRes?.rows || []).map(r => ({
        text: r.dimensionValues[0]?.value || '',
        page: r.dimensionValues[1]?.value || '',
        clicks: r.metricValues[0]?.value || '0',
      }));
      if (ctas.length === 0) ctaStatus = 'empty';
    } catch (ctaErr) {
      const msg = String(ctaErr?.message || '');
      // GA4 Data API responds with "Field customEvent:cta_text is not a valid
      // dimension" (or similar) when the dimension isn't registered.
      if (/dimension|customEvent|not.*(found|valid|exist)/i.test(msg)) {
        ctaStatus = 'not_registered';
      } else {
        ctaStatus = 'error';
      }
      console.warn('[analyticsEvents] CTA report failed (status=' + ctaStatus + '):', msg);
    }

    res.status(200).json({ events, ctas, ctaStatus });
  } catch (err) {
    console.error('Analytics Events API error:', err);
    res.status(500).json({ error: 'Failed to fetch event data.', detail: err.message });
  }
});
