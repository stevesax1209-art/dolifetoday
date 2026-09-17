// scripts/fix_broken_glyphs.js
// One-time cleanup: replace literal "?" placeholder characters (left over from
// a Unicode-mangling paste round-trip) with the intended HTML entities across
// every static page in dolifetoday/public. Also patches theclub.html to add
// the missing Inner Circle footer link.
//
// All replacements are safe idempotent literal-string swaps so re-running the
// script is a no-op.

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// -------- shared replacements applied to every HTML file --------
// Pairs of [needle, replacement]. Each pair replaces ALL occurrences.
const REPLACEMENTS = [
  // External-link arrow next to third-party destinations
  ['Book Bryce for Speaking ?</a>', 'Book Bryce for Speaking &#8599;</a>'],
  ['Podcast Network ?</a>',         'Podcast Network &#8599;</a>'],
  ['Speaking &amp; Media ?</a>',    'Speaking &amp; Media &#8599;</a>'],
  ['Merch Store ?</a>',             'Merch Store &#8599;</a>'],

  // Footer social icons — YouTube ▶, TikTok ♫ (Facebook "f" and Instagram 📷
  // already render correctly)
  [
    'aria-label="YouTube" role="listitem">?</a>',
    'aria-label="YouTube" role="listitem">&#9654;</a>',
  ],
  [
    'aria-label="TikTok" role="listitem">?</a>',
    'aria-label="TikTok" role="listitem">&#9835;</a>',
  ],

  // Scroll-to-top button — up arrow ↑
  [
    'aria-label="Scroll to top">?</button>',
    'aria-label="Scroll to top">&#8593;</button>',
  ],

  // "? Email to Someone" share button on theclub.html
  [
    '>? Email to Someone</a>',
    '>&#9993;&#65039; Email to Someone</a>',
  ],
];

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      // Skip build/vendor dirs and non-page assets
      if (name === 'admin' || name === 'lifeinmotion' || name === 'podcast' ||
          name === 'press' || name === 'exchange' || name === 'share-assets' ||
          name === 'css' || name === 'js' || name === 'Images' || name === 'images') {
        continue;
      }
      out.push(...walk(full));
    } else if (name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(PUBLIC_DIR);
let totalFileChanges = 0;
let totalHits = 0;
const perNeedleHits = Object.fromEntries(REPLACEMENTS.map(([n]) => [n, 0]));

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [needle, replacement] of REPLACEMENTS) {
    if (!after.includes(needle)) continue;
    // Count occurrences
    const count = after.split(needle).length - 1;
    perNeedleHits[needle] += count;
    totalHits += count;
    after = after.split(needle).join(replacement);
  }
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    totalFileChanges++;
    console.log('updated', path.relative(PUBLIC_DIR, file));
  }
}

console.log('\nHits per needle:');
for (const [needle, count] of Object.entries(perNeedleHits)) {
  console.log(`  ${count.toString().padStart(4)}  ${needle}`);
}
console.log(`\nTotal files changed: ${totalFileChanges}`);
console.log(`Total replacements:  ${totalHits}`);
