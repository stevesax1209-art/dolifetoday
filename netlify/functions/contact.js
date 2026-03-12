/**
 * Netlify Function: contact
 *
 * Handles the contact form by adding the sender as a MailerLite subscriber
 * (with custom fields capturing their message and inquiry type) and tagging
 * them in a dedicated "Contact Inquiries" group so the team receives a
 * MailerLite automation notification.
 *
 * Required environment variables (set in Netlify dashboard → Site → Environment):
 *   MAILERLITE_API_TOKEN          — API token from MailerLite → Integrations → API
 *   MAILERLITE_CONTACT_GROUP_ID   — (optional) MailerLite group/segment ID for contact inquiries
 *
 * Custom fields that must be created in MailerLite before use
 * (MailerLite dashboard → Subscribers → Fields → Add custom field):
 *   inquiry_type   — Text field
 *   last_message   — Long text / textarea field
 *   organization   — Text field  (may already exist as "company")
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
  let name, email, organization, inquiry_type, message;
  try {
    ({ name, email, organization, inquiry_type, message } = JSON.parse(event.body || '{}'));
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  /* ── Validate required fields ───────────────────────────────── */
  const errors = [];
  if (!name || name.trim().length < 2) errors.push('Full name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email address is required.');
  if (!inquiry_type) errors.push('Inquiry type is required.');
  if (!message || message.trim().length < 10) errors.push('Message must be at least 10 characters.');

  if (errors.length) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: errors.join(' ') }),
    };
  }

  /* ── Build MailerLite payload ────────────────────────────────── */
  const apiToken = process.env.MAILERLITE_API_TOKEN;
  const groupId  = process.env.MAILERLITE_CONTACT_GROUP_ID;

  if (!apiToken) {
    console.error('MAILERLITE_API_TOKEN environment variable is not set.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
    };
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
      // Custom fields — must be pre-created in MailerLite
      inquiry_type: inquiry_type,
      last_message: truncatedMessage,
    },
  };
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
      body: JSON.stringify({ error: 'Unable to reach messaging service. Please try again or email office@dolifetoday.com.' }),
    };
  }

  /* ── Handle MailerLite response ──────────────────────────────── */
  if (mlResponse.status === 200 || mlResponse.status === 201) {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message received! We\'ll be in touch within 24–48 hours.' }),
    };
  }

  const errorBody = await mlResponse.text();
  console.error(`MailerLite error ${mlResponse.status}:`, errorBody);

  // If it's a field-not-found error (custom fields not created yet),
  // retry without the custom fields so the core lead is still captured.
  if (mlResponse.status === 422) {
    try {
      const fallbackPayload = {
        email:  email.trim(),
        status: 'active',
        fields: { name: name.trim(), company: (organization || '').trim() },
      };
      if (groupId) fallbackPayload.groups = [groupId];

      const fallbackResponse = await fetch(MAILERLITE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(fallbackPayload),
      });

      if (fallbackResponse.status === 200 || fallbackResponse.status === 201) {
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Message received! We\'ll be in touch within 24–48 hours.' }),
        };
      }
    } catch (fallbackErr) {
      console.error('Fallback MailerLite error:', fallbackErr);
    }
  }

  return {
    statusCode: 500,
    body: JSON.stringify({ error: 'Could not send your message. Please email office@dolifetoday.com directly.' }),
  };
};
