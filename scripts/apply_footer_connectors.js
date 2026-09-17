// scripts/apply_footer_connectors.js
// Idempotently insert a "Community Connectors" link into every page's
// "The DLT Platform" footer column. Also fixes a stray missing </li> that
// appears in most pages right before Inner Circle so the injection lands
// on a clean structure.
//
// Run: node scripts/apply_footer_connectors.js

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const CONNECTORS_LI = '<li><a href="https://connectors.dolifetoday.com" target="_blank" rel="noopener noreferrer">Community Connectors &#8599;</a></li>';

// Pre-existing "Speaking The Invisible" li on many pages accidentally omits
// the closing </li> and lets Inner Circle nest inside it. Normalize it
// first so the injection anchor is well-formed.
const BROKEN_SPEAKING_LI = /<li><a href="\/speaking-the-invisible">Speaking The Invisible<\/a>\s*<a href="\/inner-circle">Inner Circle<\/a><\/li>/g;
const FIXED_SPEAKING_BLOCK = '<li><a href="/speaking-the-invisible">Speaking The Invisible</a></li>\n            <li><a href="/inner-circle">Inner Circle</a></li>';

const INNER_CIRCLE_ANCHOR = /(\s*)<li><a href="\/inner-circle">Inner Circle<\/a><\/li>/;

const SKIP = new Set([
  'admin-analytics.html',
  'admin-providers.html',
  'welcome.html',
  'share-stats.html',
  'theclub-header-comparison.html',
  'theclub-rebrand-preview.html',
  'theclub-confirmed.html',
  'theclub-next-steps.html',
  'live.html',
  'trendsense.html',
  'provider-dashboard.html',
  'provider-waitlist.html',
  'exchange-provider.html',
  'exchange-category.html',
  'exchange-location.html',
  'exchange-claim.html',
  'bryce-perry-communicator-awards-2026.html',
  'bryce-perry-parkinsons-award-2026.html',
  'inner-circle-welcome.html',
  'delete-account.html',
]);

const files = fs.readdirSync(PUBLIC_DIR)
  .filter(n => n.endsWith('.html') && !SKIP.has(n))
  .map(n => path.join(PUBLIC_DIR, n));

let changed = 0;
let alreadyPresent = 0;
let noAnchor = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  const before = content;

  // Fix the broken Speaking The Invisible li (safe to run multiple times).
  content = content.replace(BROKEN_SPEAKING_LI, FIXED_SPEAKING_BLOCK);

  if (content.includes('connectors.dolifetoday.com') && content.includes('Community Connectors &#8599;')) {
    alreadyPresent++;
    if (content !== before) {
      fs.writeFileSync(file, content, 'utf8');
      console.log('fixed speaking li only:', path.basename(file));
    }
    continue;
  }

  const m = content.match(INNER_CIRCLE_ANCHOR);
  if (!m) {
    noAnchor++;
    if (content !== before) {
      fs.writeFileSync(file, content, 'utf8');
    }
    continue;
  }

  const indent = m[1] || '\n            ';
  const injection = `${indent}${CONNECTORS_LI}${indent}<li><a href="/inner-circle">Inner Circle</a></li>`;
  content = content.replace(INNER_CIRCLE_ANCHOR, injection);

  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    changed++;
    console.log('updated:', path.basename(file));
  }
}

console.log(`\nChanged: ${changed}`);
console.log(`Already present: ${alreadyPresent}`);
console.log(`No Inner Circle anchor: ${noAnchor}`);
console.log(`Total candidate files: ${files.length}`);
