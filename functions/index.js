'use strict';

/**
 * Firebase Cloud Functions for Doing Life Today
 *
 * Endpoints (rewritten via Firebase Hosting in firebase.json):
 *   POST /api/subscribe  →  subscribe()  — newsletter sign-up via MailerLite API v3
 *   POST /api/contact    →  contact()    — contact form via MailerLite API v3
 *
 * Environment variables (set in Firebase Console → Functions → Configuration,
 * or via CLI: firebase functions:config:set mailerlite.token="..." etc.):
 *   MAILERLITE_API_TOKEN          — required
 *   MAILERLITE_GROUP_ID                 — optional; newsletter group ID
 *   MAILERLITE_CONTACT_GROUP_ID         — optional; contact inquiries group ID
 *   MAILERLITE_THECLUB_WAITLIST_GROUP_ID — optional; The Club waitlist group ID
 */

const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const LEGACY_WAITLIST_BASE_COUNT = 68;

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

function buildWaitlistDocId(email) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

async function upsertWaitlistEntry(email, source) {
  const normalizedEmail = email.trim().toLowerCase();
  const waitlistRef = db.collection('waitlist').doc(buildWaitlistDocId(normalizedEmail));
  const snapshot = await waitlistRef.get();

  if (snapshot.exists) {
    return;
  }

  await waitlistRef.set({
    email: normalizedEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    source: typeof source === 'string' && source.trim() ? source.trim() : 'club_waitlist',
  });
}

async function getWaitlistCount() {
  const snapshot = await db.collection('waitlist').where('source', '==', 'club_waitlist').count().get();
  return LEGACY_WAITLIST_BASE_COUNT + snapshot.data().count;
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

/* ── subscribe ───────────────────────────────────────────────── */

exports.subscribe = onRequest(
  {
    secrets: [
      'MAILERLITE_API_TOKEN',
      'MAILERLITE_GROUP_ID',
      'MAILERLITE_THECLUB_WAITLIST_GROUP_ID',
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
    const { email, list, audienceRole, source } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const apiToken = process.env.MAILERLITE_API_TOKEN;
    const requestedList = typeof list === 'string' ? list.trim() : '';
    const groupIds = {
      newsletter: process.env.MAILERLITE_GROUP_ID,
      theclub_waitlist: process.env.MAILERLITE_THECLUB_WAITLIST_GROUP_ID || process.env.MAILERLITE_GROUP_ID,
    };
    const groupId = groupIds[requestedList] || groupIds.newsletter;

    if (!apiToken) {
      functions.logger.error('MAILERLITE_API_TOKEN is not set.');
      res.status(500).json({ error: 'Server configuration error. Please try again later.' });
      return;
    }

    const payload = { email, status: 'active' };
    if (groupId) payload.groups = [groupId];
    if (requestedList === 'theclub_waitlist') {
      payload.fields = {
        source: typeof source === 'string' && source.trim() ? source.trim() : 'club_waitlist',
      };

      if (audienceRole) {
        payload.fields.audience_role = audienceRole;
      }
    }

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
        if (requestedList === 'theclub_waitlist') {
          await upsertWaitlistEntry(email, source);
        }

        res.status(200).json({
          message: requestedList === 'theclub_waitlist'
            ? "You're on the list. We'll notify you when your wave opens."
            : 'Subscribed successfully!',
        });
        return;
      }

      // 422 = already subscribed — treat as success
      if (mlRes.status === 422) {
        if (requestedList === 'theclub_waitlist') {
          await upsertWaitlistEntry(email, source);
        }

        res.status(200).json({
          message: requestedList === 'theclub_waitlist'
            ? "You're already on the list. We'll notify you when your wave opens."
            : 'You are already subscribed — thank you!',
        });
        return;
      }

      const errText = await mlRes.text();
      functions.logger.error(`MailerLite error ${mlRes.status}:`, errText);
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
    const count = await getWaitlistCount();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.status(200).json({ count });
  } catch (error) {
    functions.logger.error('Unable to read waitlist count:', error);
    res.status(500).json({ error: 'Unable to retrieve waitlist count.' });
  }
});

/* ── contact ─────────────────────────────────────────────────── */

exports.contact = onRequest(
  {
    secrets: [
      'MAILERLITE_API_TOKEN',
      'MAILERLITE_CONTACT_GROUP_ID',
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

    const { name, email, organization, inquiry_type, message } = parseBody(req);

    const errors = [];
    if (!name || name.trim().length < 2) errors.push('Full name is required.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email address is required.');
    if (!inquiry_type) errors.push('Inquiry type is required.');
    if (!message || message.trim().length < 10) errors.push('Message must be at least 10 characters.');

    if (errors.length) {
      res.status(400).json({ error: errors.join(' ') });
      return;
    }

    const apiToken = process.env.MAILERLITE_API_TOKEN;
    const groupId = process.env.MAILERLITE_CONTACT_GROUP_ID;

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
