'use strict';

/**
 * Firebase Cloud Functions for Doing Life Today
 *
 * Endpoints (rewritten via Firebase Hosting in firebase.json):
 *   GET  /api/public-config  →  publicConfig() — public client config such as reCAPTCHA site key
 *   POST /api/subscribe  →  subscribe()  — newsletter sign-up via MailerLite API v3
 *   POST /api/contact    →  contact()    — contact form via MailerLite API v3
 *   POST /api/mailerlite-webhook → mailerLiteWebhook() — waitlist confirmation sync from MailerLite
 *
 * Environment variables (set in Firebase Console → Functions → Configuration,
 * or via CLI: firebase functions:config:set mailerlite.token="..." etc.):
 *   MAILERLITE_API_TOKEN          — required
 *   MAILERLITE_GROUP_ID                 — optional; newsletter group ID
 *   MAILERLITE_CONTACT_GROUP_ID         — optional; contact inquiries group ID
 *   MAILERLITE_THECLUB_WAITLIST_GROUP_ID — optional; The Club waitlist group ID
 *   RECAPTCHA_SITE_KEY                  — required for frontend rendering
 *   RECAPTCHA_SECRET_KEY                — required for server-side verification
 *   MAILERLITE_WEBHOOK_SECRET           — required to validate MailerLite webhook signatures
 */

const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const WAITLIST_STATS_COLLECTION = 'site_stats';
const WAITLIST_STATS_DOC_ID = 'club_waitlist';
const SHARE_STATS_DOC_ID = 'club_share_stats';
const CLUB_PAGE_STATS_DOC_ID = 'club_page_stats';
const LEGACY_WAITLIST_MIGRATION_COUNT = 68;
const WAITLIST_MANUAL_COUNT_ADJUSTMENT = 19;
const RATE_LIMIT_COLLECTION = 'submission_rate_limits';
const REJECTION_LOG_COLLECTION = 'submission_rejections';
const WAITLIST_SOURCE = 'club_waitlist';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_BLOCK_THRESHOLD = 3;
const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WAITLIST_TRACKING_WAVES = Object.freeze([1, 2, 3, 4]);
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
  res.set('Access-Control-Allow-Headers', 'Content-Type');
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
  return 4;
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

async function syncConfirmedWaitlistSubscriber({ email, source, audienceRole, apiToken }) {
  await ensureWaitlistStatsDoc();

  const waitlistCounted = await upsertWaitlistEntry(email, source || WAITLIST_SOURCE);
  const count = await getWaitlistCount();
  const wave = computeWave(count);

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
  {
    secrets: ['RECAPTCHA_SITE_KEY'],
  },
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
  {
    secrets: [
      'MAILERLITE_API_TOKEN',
      'MAILERLITE_GROUP_ID',
      'MAILERLITE_THECLUB_WAITLIST_GROUP_ID',
      'RECAPTCHA_SECRET_KEY',
    ],
  },
  async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const body = parseBody(req);
    const { email, list, audienceRole, source, recaptchaToken, website_url, company_name_hidden } = body;
    const clientIp = getClientIp(req);
    const requestedList = typeof list === 'string' ? list.trim() : '';

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
      projectedWave = computeWave(projectedWaitlistCount + 1);
    }

    const payload = {
      email: email.trim().toLowerCase(),
      status: requestedList === 'theclub_waitlist' ? 'unconfirmed' : 'active',
    };
    if (groupId) payload.groups = [groupId];

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
          });
          waitlistCounted = confirmationSync.waitlistCounted;
          count = confirmationSync.count;
          wave = confirmationSync.wave;
        } else if (requestedList === 'theclub_waitlist') {
          waitlistCounted = await upsertWaitlistEntry(email, source || WAITLIST_SOURCE);
          count = await getWaitlistCount();
          wave = computeWave(count);

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
    const [shareStats, clubStats] = await Promise.all([
      getShareStats(),
      getClubPageStats(),
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
    });
  } catch (error) {
    functions.logger.error('Unable to retrieve share stats:', error);
    res.status(500).json({ error: 'Unable to retrieve share stats.' });
  }
});

/* ── contact ─────────────────────────────────────────────────── */

exports.contact = onRequest(
  {
    secrets: [
      'MAILERLITE_API_TOKEN',
      'MAILERLITE_CONTACT_GROUP_ID',
      'RECAPTCHA_SECRET_KEY',
    ],
  },
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

    const apiToken = getEnvValue('MAILERLITE_API_TOKEN');
    const groupId = getEnvValue('MAILERLITE_CONTACT_GROUP_ID');

    if (!apiToken) {
      functions.logger.error('MAILERLITE_API_TOKEN is not set.');
      res.status(500).json({ error: 'Server configuration error. Please try again later.' });
      return;
    }

    // MailerLite text custom fields accept up to 500 characters.
    const MAX_FIELD_LENGTH = 500;
    const truncatedMessage = message.trim().substring(0, MAX_FIELD_LENGTH);

    const payload = {
      email: email.trim(),
      status: 'active',
      fields: {
        name: name.trim(),
        company: (organization || '').trim(),
        inquiry_type,
        last_message: truncatedMessage,
      },
    };
    if (groupId) payload.groups = [groupId];

    try {
      const mlRes = await fetch(MAILERLITE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (mlRes.status === 200 || mlRes.status === 201) {
        res.status(200).json({ message: "Message received! We'll be in touch within 24-48 hours." });
        return;
      }

      const errText = await mlRes.text();
      functions.logger.error(`MailerLite error ${mlRes.status}:`, errText);

      // MailerLite may reject an invalid group with a generic 500; retry without groups.
      if (groupId) {
        const noGroupPayload = {
          email: email.trim(),
          status: 'active',
          fields: {
            name: name.trim(),
            company: (organization || '').trim(),
            inquiry_type,
            last_message: truncatedMessage,
          },
        };

        try {
          const noGroupRes = await fetch(MAILERLITE_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify(noGroupPayload),
          });

          if (noGroupRes.status === 200 || noGroupRes.status === 201) {
            res.status(200).json({ message: "Message received! We'll be in touch within 24-48 hours." });
            return;
          }
        } catch (noGroupErr) {
          functions.logger.error('MailerLite retry without group failed:', noGroupErr);
        }
      }

      // 422 may indicate custom fields are missing; retry with basic fields only.
      if (mlRes.status === 422) {
        const fallbackPayload = {
          email: email.trim(),
          status: 'active',
          fields: {
            name: name.trim(),
            company: (organization || '').trim(),
          },
        };
        if (groupId) fallbackPayload.groups = [groupId];

        try {
          const fbRes = await fetch(MAILERLITE_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify(fallbackPayload),
          });

          if (fbRes.status === 200 || fbRes.status === 201) {
            res.status(200).json({ message: "Message received! We'll be in touch within 24-48 hours." });
            return;
          }
        } catch (fbErr) {
          functions.logger.error('Fallback MailerLite error:', fbErr);
        }
      }

      res.status(500).json({ error: 'Message could not be delivered. Please try again later.' });
    } catch (err) {
      functions.logger.error('Network error calling MailerLite:', err);
      res.status(502).json({ error: 'Unable to reach contact service. Please try again later.' });
    }
  }
);

/* ── mailerLiteWebhook ─────────────────────────────────────── */

exports.mailerLiteWebhook = onRequest(
  {
    secrets: [
      'MAILERLITE_API_TOKEN',
      'MAILERLITE_GROUP_ID',
      'MAILERLITE_THECLUB_WAITLIST_GROUP_ID',
      'MAILERLITE_WEBHOOK_SECRET',
    ],
  },
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

async function sendProviderEmail(to, subject, body) {
  const apiToken = getEnvValue('MAILERLITE_API_TOKEN');
  if (!apiToken) {
    functions.logger.warn('MAILERLITE_API_TOKEN not set — skipping provider email');
    return;
  }
  try {
    await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        email: to,
        fields: {
          provider_email_subject: subject,
          provider_email_body: body,
        },
      }),
    });
  } catch (err) {
    functions.logger.error('Provider email send failed:', err);
  }
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
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(userRecord.uid).set({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: 'provider',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      token: customToken,
      expiresIn: 3600000,
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
    const apiKey = getEnvValue('FIREBASE_WEB_API_KEY');
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

    res.status(200).json({
      token: authData.idToken,
      expiresIn: parseInt(authData.expiresIn, 10) * 1000 || 3600000,
      user: {
        uid,
        email: authData.email,
        name: accountData.name || authData.displayName || '',
      },
    });
  } catch (err) {
    functions.logger.error('Provider signin error:', err);
    res.status(500).json({ error: 'Unable to sign in. Please try again.' });
  }
});

/* ── Create Listing ────────────────────────────────────────── */

exports.providerCreate = onRequest(async (req, res) => {
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

  await sendProviderEmail(
    decoded.email || '',
    'Your listing is under review',
    `Hi! Your listing "${name}" has been submitted and is under review. This usually takes 24–48 hours.`
  );

  res.status(201).json({ id: docRef.id, slug, status: 'PENDING' });
});

/* ── Claim Listing ─────────────────────────────────────────── */

exports.providerClaim = onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  const decoded = await verifyProviderToken(req);
  if (!decoded) { res.status(401).json({ error: 'Authentication required.' }); return; }

  const body = parseBody(req);
  const providerId = normalizeText(body.providerId);
  const providerName = normalizeText(body.providerName);
  const role = normalizeText(body.role);

  if (!providerName) {
    res.status(400).json({ error: 'Provider information is required.' }); return;
  }

  // Check if listing is already claimed
  if (providerId) {
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
  }

  const slug = slugify(providerName) + '-' + Date.now().toString(36);

  const claimDoc = {
    name: providerName,
    slug,
    externalProviderId: providerId,
    claimRole: role,
    claimPhone: (body.phone || '').trim().slice(0, 50),
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

  await sendProviderEmail(
    decoded.email || '',
    'Your listing is under review',
    `Hi! Your claim for "${providerName}" has been submitted and is under review. This usually takes 24–48 hours.`
  );

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

  // Only VERIFIED and COMMUNITY tiers can edit
  const tier = (existing.tier || 'FREE').toUpperCase();
  if (tier === 'FREE') {
    res.status(403).json({ error: 'Upgrade to Verified ($9/mo) to edit your listing.' }); return;
  }

  const body = parseBody(req);
  const ALLOWED_FIELDS = ['name', 'category', 'format', 'description', 'city', 'state', 'country', 'website', 'phone', 'tags'];
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) {
      if (field === 'tags') {
        updates.tags = typeof body.tags === 'string'
          ? body.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
          : [];
      } else if (field === 'description') {
        updates.description = String(body.description || '').trim().slice(0, 2000);
      } else if (field === 'website') {
        updates.website = String(body.website || '').trim().slice(0, 500);
      } else {
        updates[field] = normalizeText(body[field]).slice(0, 200);
      }
    }
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
  snapshot.forEach(doc => {
    const data = doc.data();
    const views = data.views || 0;
    const disc = (data.clubData || {}).discussion_count || 0;
    const revs = (data.clubData || {}).review_count || 0;
    const uScore = (views * 0.2) + (disc * 5) + (revs * 5);
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
    });
  });

  res.status(200).json({ providers });
});

/* ── Admin: Approve ────────────────────────────────────────── */

exports.adminProviderApprove = onRequest(async (req, res) => {
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
    approved_at: Date.now(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // If $49 tier, boost ranking and trigger Club activation
  if ((data.tier || '').toUpperCase() === 'COMMUNITY') {
    approveUpdate.boostScore = 100;
    approveUpdate.clubActivatedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await providerRef.update(approveUpdate);

  // Send approval email
  const ownerUid = data.claimedBy;
  if (ownerUid) {
    const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(ownerUid).get();
    const accountEmail = accountDoc.exists ? accountDoc.data().email : '';
    if (accountEmail) {
      await sendProviderEmail(accountEmail, 'Your listing is live!',
        `Great news! Your listing "${data.name || ''}" has been approved and is now live on The Exchange.`
      );
    }
  }

  res.status(200).json({ success: true, status: 'APPROVED' });
});

/* ── Admin: Reject ─────────────────────────────────────────── */

exports.adminProviderReject = onRequest(async (req, res) => {
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
    rejectionReason: reason.trim().slice(0, 500),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const ownerUid = data.claimedBy;
  if (ownerUid) {
    const accountDoc = await db.collection(PROVIDER_ACCOUNTS_COLLECTION).doc(ownerUid).get();
    const accountEmail = accountDoc.exists ? accountDoc.data().email : '';
    if (accountEmail) {
      await sendProviderEmail(accountEmail, 'Action required — your listing needs changes',
        `Your listing "${data.name || ''}" needs some changes before it can go live. Reason: ${reason.trim()}`
      );
    }
  }

  res.status(200).json({ success: true, status: 'REJECTED' });
});

/* ── Admin: Flag ───────────────────────────────────────────── */

exports.adminProviderFlag = onRequest(async (req, res) => {
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

  await providerRef.update({
    status: 'FLAGGED',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(200).json({ success: true, status: 'FLAGGED' });
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
