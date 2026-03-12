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
 *   MAILERLITE_GROUP_ID           — optional; newsletter group ID
 *   MAILERLITE_CONTACT_GROUP_ID   — optional; contact inquiries group ID
 */

const functions = require('firebase-functions');

const MAILERLITE_API_URL = 'https://connect.mailerlite.com/api/subscribers';

/* ── Helpers ─────────────────────────────────────────────────── */

function parseBody(req) {
  if (typeof req.body === 'object' && req.body !== null) return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

/* ── subscribe ───────────────────────────────────────────────── */

exports.subscribe = functions.https.onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { email } = parseBody(req);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  const apiToken = process.env.MAILERLITE_API_TOKEN;
  const groupId  = process.env.MAILERLITE_GROUP_ID;

  if (!apiToken) {
    functions.logger.error('MAILERLITE_API_TOKEN is not set.');
    res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    return;
  }

  const payload = { email, status: 'active' };
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
      res.status(200).json({ message: 'Subscribed successfully!' });
      return;
    }

    // 422 = already subscribed — treat as success
    if (mlRes.status === 422) {
      res.status(200).json({ message: 'You are already subscribed — thank you!' });
      return;
    }

    const errText = await mlRes.text();
    functions.logger.error(`MailerLite error ${mlRes.status}:`, errText);
    res.status(500).json({ error: 'Subscription failed. Please try again later.' });
  } catch (err) {
    functions.logger.error('Network error calling MailerLite:', err);
    res.status(502).json({ error: 'Unable to reach subscription service. Please try again later.' });
  }
});

/* ── contact ─────────────────────────────────────────────────── */

exports.contact = functions.https.onRequest(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { name, email, organization, inquiry_type, message } = parseBody(req);

  const errors = [];
  if (!name || name.trim().length < 2)      errors.push('Full name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email address is required.');
  if (!inquiry_type)                         errors.push('Inquiry type is required.');
  if (!message || message.trim().length < 10) errors.push('Message must be at least 10 characters.');

  if (errors.length) {
    res.status(400).json({ error: errors.join(' ') });
    return;
  }

  const apiToken = process.env.MAILERLITE_API_TOKEN;
  const groupId  = process.env.MAILERLITE_CONTACT_GROUP_ID;

  if (!apiToken) {
    functions.logger.error('MAILERLITE_API_TOKEN is not set.');
    res.status(500).json({ error: 'Server configuration error. Please try again later.' });
    return;
  }

  // MailerLite text custom fields accept up to 500 characters
  const MAX_FIELD_LENGTH = 500;
  const truncatedMessage = message.trim().substring(0, MAX_FIELD_LENGTH);

  const payload = {
    email: email.trim(),
    status: 'active',
    fields: {
      name:         name.trim(),
      company:      (organization || '').trim(),
      // Custom fields — must be pre-created in MailerLite dashboard:
      //   inquiry_type (Text), last_message (Text)
      inquiry_type: inquiry_type,
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
      res.status(200).json({ message: "Message received! We'll be in touch within 24–48 hours." });
      return;
    }

    const errText = await mlRes.text();
    functions.logger.error(`MailerLite error ${mlRes.status}:`, errText);

    // 422 = custom fields may not exist yet — retry without them
    if (mlRes.status === 422) {
      const fallbackPayload = {
        email:  email.trim(),
        status: 'active',
        fields: { name: name.trim(), company: (organization || '').trim() },
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
          res.status(200).json({ message: "Message received! We'll be in touch within 24–48 hours." });
          return;
        }
      } catch (fbErr) {
        functions.logger.error('Fallback MailerLite error:', fbErr);
      }
    }

    res.status(500).json({ error: 'Could not send your message. Please email office@dolifetoday.com directly.' });
  } catch (err) {
    functions.logger.error('Network error calling MailerLite:', err);
    res.status(502).json({ error: 'Unable to reach messaging service. Please try again or email office@dolifetoday.com.' });
  }
});
