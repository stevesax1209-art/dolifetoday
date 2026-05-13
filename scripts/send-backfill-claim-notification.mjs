// One-shot: send backfill admin notification for the first Exchange claim
// (Parkinson's Resource Organization - willenborgkelly@gmail.com).
// The original new-claim email did not fire because ADMIN_NOTIFY_EMAIL was
// not loaded in the deployed providerClaim function until 2026-04-27.
//
// Usage: MAILERSEND_API_KEY=mlsn.xxx node scripts/send-backfill-claim-notification.mjs

const apiKey = process.env.MAILERSEND_API_KEY;
if (!apiKey) {
  console.error('MAILERSEND_API_KEY env var required');
  process.exit(1);
}

const html = `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;padding:24px;">
<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin-bottom:20px;border-radius:4px;font-size:14px;color:#92400e;">
<strong>Backfill notification</strong> &mdash; the original new-claim alert did not fire because <code>ADMIN_NOTIFY_EMAIL</code> was not loaded in the deployed function until 2026-04-27. This email is for your records.
</div>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 20px;color:#1f2937;">First Exchange claim approved</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
<tr><td style="padding:6px 8px;color:#6b7280;width:140px;">Provider</td><td style="padding:6px 8px;font-weight:600;">Parkinson's Resource Organization</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Category</td><td style="padding:6px 8px;">support-group</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Tier</td><td style="padding:6px 8px;">FREE</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Claim email</td><td style="padding:6px 8px;">willenborgkelly@gmail.com</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Role</td><td style="padding:6px 8px;">(not provided)</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Phone</td><td style="padding:6px 8px;">(not provided)</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Submitted</td><td style="padding:6px 8px;">~2026-04-25 (~48h turnaround)</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Approved</td><td style="padding:6px 8px;">2026-04-27</td></tr>
<tr><td style="padding:6px 8px;color:#6b7280;">Status</td><td style="padding:6px 8px;">APPROVED &middot; verified=true &middot; synced to Club app</td></tr>
</table>
<h2 style="font-size:16px;margin:20px 0 8px;">Follow-ups</h2>
<ul style="margin:0 0 16px;padding-left:20px;">
<li>Confirm she received the approval email and can sign in at <a href="https://dolifetoday.com/provider-dashboard">/provider-dashboard</a>.</li>
<li>Heads up: the claim flow creates a sparse providers doc (city/category/description/website blank). Her dashboard will be mostly empty until she fills it in.</li>
</ul>
<p style="margin:20px 0 8px;color:#6b7280;font-size:14px;">Going forward, every new claim will email this inbox automatically.</p>
<p style="margin:24px 0 16px;"><a href="https://dolifetoday.com/admin-providers" style="display:inline-block;background-color:#1f7a8c;color:#ffffff;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:16px;">Review in Admin</a></p>
<p style="margin:24px 0 0;color:#6b7280;font-size:14px;">- The Exchange, Doing Life Today</p>
</div>`;

const text = `BACKFILL NOTIFICATION (the original new-claim alert did not fire because ADMIN_NOTIFY_EMAIL was not loaded in the deployed function until 2026-04-27).

This is a record of the first real Exchange claim, which has already been approved.

Provider: Parkinson's Resource Organization
Category: support-group
Tier: FREE
Claim email: willenborgkelly@gmail.com
Role: (not provided)
Phone: (not provided)
Submitted: ~2026-04-25 (turnaround was ~48 hours)
Approved: 2026-04-27 (you)
Status: APPROVED, verified=true, synced to pcn---new pathway-providers

Action items still pending:
- Confirm willenborgkelly received the approval email and can sign in at https://dolifetoday.com/provider-dashboard
- Note: claim flow currently creates a sparse providers doc (city/category/description/website blank). Provider dashboard will show mostly-empty fields until she fills them in.

Going forward: every new claim will trigger a "New claim: <name>" email to this inbox.

Review in admin: https://dolifetoday.com/admin-providers`;

const body = {
  from: { email: 'exchange@dolifetoday.com', name: 'The Exchange - Doing Life Today' },
  to: [{ email: 'admin@dolifetoday.com' }],
  reply_to: { email: 'exchange@dolifetoday.com', name: 'The Exchange - Doing Life Today' },
  subject: "[BACKFILL] First claim approved: Parkinson's Resource Organization",
  text,
  html,
};

const res = await fetch('https://api.mailersend.com/v1/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
});

console.log('Status:', res.status);
console.log('x-message-id:', res.headers.get('x-message-id'));
const respText = await res.text();
if (respText) console.log('Body:', respText);
if (!res.ok) process.exit(1);
