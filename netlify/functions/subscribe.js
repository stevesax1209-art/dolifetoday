/**
 * Netlify Function: subscribe
 *
 * Handles newsletter sign-up by adding the email address to a MailerLite
 * subscriber group via the MailerLite API v3.
 *
 * Required environment variables (set in Netlify dashboard → Site → Environment):
 *   MAILERLITE_API_TOKEN       — API token from MailerLite → Integrations → API
 *   MAILERLITE_GROUP_ID        — (optional) MailerLite group/segment ID for newsletter subscribers
 *
 * MailerLite API docs: https://developers.mailerlite.com/docs/subscribers
 */

const MAILERLITE_API_URL = 'https://connect.mailerlite.com/api/subscribers';

exports.handler = async (event) => {
  /* ── Only allow POST ─────────────────────────────────────────── */
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  /* ── Parse body ──────────────────────────────────────────────── */
  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'A valid email address is required.' }),
    };
  }

  /* ── Build MailerLite payload ────────────────────────────────── */
  const apiToken = process.env.MAILERLITE_API_TOKEN;
  const groupId  = process.env.MAILERLITE_GROUP_ID;

  if (!apiToken) {
    console.error('MAILERLITE_API_TOKEN environment variable is not set.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
    };
  }

  const payload = { email, status: 'active' };
  if (groupId) {
    payload.groups = [groupId];
  }

  /* ── Call MailerLite API ─────────────────────────────────────── */
  let mlResponse;
  try {
    mlResponse = await fetch(MAILERLITE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    console.error('MailerLite network error:', networkErr);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Unable to reach subscription service. Please try again later.' }),
    };
  }

  /* ── Handle MailerLite response ──────────────────────────────── */
  // 200 = updated, 201 = created — both are success
  if (mlResponse.status === 200 || mlResponse.status === 201) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Subscribed successfully!' }),
    };
  }

  // 422 = email already exists or validation error — still a "soft" success for UX
  if (mlResponse.status === 422) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'You are already subscribed — thank you!' }),
    };
  }

  const errorBody = await mlResponse.text();
  console.error(`MailerLite error ${mlResponse.status}:`, errorBody);
  return {
    statusCode: 500,
    body: JSON.stringify({ error: 'Subscription failed. Please try again later.' }),
  };
};
