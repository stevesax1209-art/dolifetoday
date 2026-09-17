// scripts/apply_canonical_nav.js
// Replace every page's <header class="site-header">...</header> block AND
// its <nav class="mobile-nav" ...>...</nav> block with a single canonical
// structure. Idempotent — re-running is a no-op when the file already has
// the canonical markers.
//
// Preserves everything else in the file (title, body content, JSON-LD, etc).

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// -------- canonical header --------
const CANONICAL_HEADER = `<header class="site-header" role="banner" data-canonical-nav="v4">
    <nav class="nav-inner" aria-label="Main navigation">
      <a href="/" class="nav-logo" aria-label="Doing Life Today - Home">
        <div class="nav-logo-mark" aria-hidden="true">DL</div>
        <div class="nav-logo-text">Doing Life Today<span>Parkinson's Community</span></div>
      </a>
      <ul class="nav-links" role="list">
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">About</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/about" role="menuitem">About Doing Life Today<small>Our story &amp; mission</small></a></li>
            <li role="none"><a href="/about#awards" role="menuitem">Awards &amp; Recognition<small>Communicator Awards &amp; Parkinson's advocacy</small></a></li>
            <li role="none"><a href="https://bryceperry.org" target="_blank" rel="noopener noreferrer" role="menuitem">Bryce Perry &middot; Speaking &amp; Media<small>Book Bryce &middot; press</small></a></li>
            <li role="none"><a href="/contact" role="menuitem">Contact<small>Get in touch</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown nav-dropdown--highlight">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">The Club</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/theclub" role="menuitem">The Club<small>Learn about the community</small></a></li>
            <li role="none"><a href="/theclub#download" role="menuitem">Join The Club<small>Download &amp; sign up free</small></a></li>
            <li role="none"><a href="/parkinsons-daily-check-in" role="menuitem">Daily Check-In<small>Track how you're doing</small></a></li>
            <li role="none"><a href="/parkinsons-symptom-tracker" role="menuitem">Symptom Tracker<small>Log symptoms over time</small></a></li>
            <li role="none"><a href="/clinical-trial-match" role="menuitem">Clinical Trial Match<small>Find trials near you</small></a></li>
            <li role="none"><a href="/inner-circle" role="menuitem">Inner Circle<small>Deeper community experiences</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">Watch &amp; Listen</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/podcasts" role="menuitem">Podcasts Hub<small>All DLT podcasts</small></a></li>
            <li role="none"><a href="/living-with-parkinsons-podcast" role="menuitem">Living With Parkinson's Podcast<small>Weekly episodes</small></a></li>
            <li role="none"><a href="/life-in-motion" role="menuitem">Life in Motion<small>Movement &amp; Parkinson's</small></a></li>
            <li role="none"><a href="/youtube" role="menuitem">YouTube<small>Videos &amp; interviews</small></a></li>
            <li role="none"><a href="/music" role="menuitem">Music<small>Music &amp; therapy</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">Care Partners</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/carmens-care-partner-corner" role="menuitem">Carmen's Care Partner Corner<small>Dashboard, Circle, daily check-ins</small></a></li>
            <li role="none"><a href="/care-partners" role="menuitem">Care Partners Guide<small>Supporting someone with Parkinson's</small></a></li>
            <li role="none"><a href="/caregiver-burnout" role="menuitem">Caregiver Burnout<small>Spot it and recover</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">Living With Parkinson's</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/living-with-parkinsons-guide" role="menuitem">Living With Parkinson's Guide<small>The full guide</small></a></li>
            <li role="none"><a href="/newly-diagnosed" role="menuitem">Newly Diagnosed<small>Start here</small></a></li>
            <li role="none"><a href="/first-90-days-parkinsons" role="menuitem">First 90 Days<small>What to do first</small></a></li>
            <li role="none"><a href="/early-signs-of-parkinsons" role="menuitem">Early Signs<small>Recognize the signs</small></a></li>
            <li role="none"><a href="/symptoms" role="menuitem">Symptoms Directory<small>Tremor, sleep, DBS &amp; more</small></a></li>
            <li role="none"><a href="/parkinsons-medication-timing" role="menuitem">Medication Timing<small>Get the most from your meds</small></a></li>
            <li role="none"><a href="/dbs-surgery" role="menuitem">DBS Surgery<small>Deep brain stimulation</small></a></li>
            <li role="none"><a href="/best-exercises-for-parkinsons" role="menuitem">Best Exercises<small>Move your best</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">The Exchange</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/exchange" role="menuitem">Search The Exchange<small>12,000+ Parkinson's programs, services &amp; products near you</small></a></li>
            <li role="none"><a href="/for-providers" role="menuitem">For Providers &middot; Get Listed<small>Grow your Parkinson's program, service, or product</small></a></li>
            <li role="none"><a href="/claim-listing" role="menuitem">Claim Your Listing<small>Take ownership of an existing entry</small></a></li>
            <li role="none"><a href="/create-listing" role="menuitem">Add Your Business<small>List a new provider or product</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">Community</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/events" role="menuitem">Events<small>Live meetups &amp; groups</small></a></li>
            <li role="none"><a href="/share" role="menuitem">Spread the Word<small>Share DLT with your community</small></a></li>
            <li role="none"><a href="/free-parkinsons-community" role="menuitem">Support Groups &amp; Free Community<small>Free ways to connect</small></a></li>
            <li role="none"><a href="/parkinsons-community" role="menuitem">Parkinson's Community<small>What community looks like</small></a></li>
          </ul>
        </li>
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">Resources</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/resources" role="menuitem">All Resources<small>Every resource, one page</small></a></li>
            <li role="none"><a href="/parkinsons-clinician-handouts" role="menuitem">Clinician Handouts<small>Print-friendly one-pagers</small></a></li>
            <li role="none"><a href="/store" role="menuitem">Store<small>DLT merch</small></a></li>
          </ul>
        </li>
      </ul>
      <a href="/theclub" class="btn btn-primary btn-sm nav-cta">Join The Club</a>
      <button class="hamburger" id="hamburger" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="mobile-nav">
        <span></span><span></span><span></span>
      </button>
    </nav>
  </header>`;

const CANONICAL_MOBILE_NAV = `<nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation" data-canonical-nav="v4">
    <details class="mobile-nav-group">
      <summary>About</summary>
      <a href="/about">About Doing Life Today</a>
      <a href="/about#awards">Awards &amp; Recognition</a>
      <a href="https://bryceperry.org" target="_blank" rel="noopener noreferrer">Bryce Perry &middot; Speaking &amp; Media</a>
      <a href="/contact">Contact</a>
    </details>
    <details class="mobile-nav-group mobile-nav-group--highlight">
      <summary>The Club</summary>
      <a href="/theclub">The Club</a>
      <a href="/theclub#download">Join The Club</a>
      <a href="/parkinsons-daily-check-in">Daily Check-In</a>
      <a href="/parkinsons-symptom-tracker">Symptom Tracker</a>
      <a href="/clinical-trial-match">Clinical Trial Match</a>
      <a href="/inner-circle">Inner Circle</a>
    </details>
    <details class="mobile-nav-group">
      <summary>Watch &amp; Listen</summary>
      <a href="/podcasts">Podcasts Hub</a>
      <a href="/living-with-parkinsons-podcast">Living With Parkinson's Podcast</a>
      <a href="/life-in-motion">Life in Motion</a>
      <a href="/youtube">YouTube</a>
      <a href="/music">Music</a>
    </details>
    <details class="mobile-nav-group">
      <summary>Care Partners</summary>
      <a href="/carmens-care-partner-corner">Carmen's Care Partner Corner</a>
      <a href="/care-partners">Care Partners Guide</a>
      <a href="/caregiver-burnout">Caregiver Burnout</a>
    </details>
    <details class="mobile-nav-group">
      <summary>Living With Parkinson's</summary>
      <a href="/living-with-parkinsons-guide">Living With Parkinson's Guide</a>
      <a href="/newly-diagnosed">Newly Diagnosed</a>
      <a href="/first-90-days-parkinsons">First 90 Days</a>
      <a href="/early-signs-of-parkinsons">Early Signs</a>
      <a href="/symptoms">Symptoms Directory</a>
      <a href="/parkinsons-medication-timing">Medication Timing</a>
      <a href="/dbs-surgery">DBS Surgery</a>
      <a href="/best-exercises-for-parkinsons">Best Exercises</a>
    </details>
    <details class="mobile-nav-group">
      <summary>The Exchange</summary>
      <a href="/exchange">Search The Exchange</a>
      <a href="/for-providers">For Providers &middot; Get Listed</a>
      <a href="/claim-listing">Claim Your Listing</a>
      <a href="/create-listing">Add Your Business</a>
    </details>
    <details class="mobile-nav-group">
      <summary>Community</summary>
      <a href="/events">Events</a>
      <a href="/share">Spread the Word</a>
      <a href="/free-parkinsons-community">Support Groups &amp; Free Community</a>
      <a href="/parkinsons-community">Parkinson's Community</a>
    </details>
    <details class="mobile-nav-group">
      <summary>Resources</summary>
      <a href="/resources">All Resources</a>
      <a href="/parkinsons-clinician-handouts">Clinician Handouts</a>
      <a href="/store">Store</a>
    </details>
    <div class="mobile-cta"><a href="/theclub" class="btn btn-primary">Join The Club</a></div>
  </nav>`;

// Regexes: greedy across newlines but not across successive headers, so use
// non-greedy match + explicit close tag.
const HEADER_RE = /<header class="site-header"[\s\S]*?<\/header>/;
const MOBILE_NAV_RE = /<nav class="mobile-nav"[\s\S]*?<\/nav>/;

// Pages to skip (admin, previews, redirect targets etc.)
const SKIP = new Set([
  'admin-analytics.html',
  'admin-providers.html',
  'welcome.html',
  'check-wave.html',
  'delete-account.html',
  'share-stats.html',
  'theclub-header-comparison.html',
  'theclub-rebrand-preview.html',
  'theclub-confirmed.html',
  'theclub-next-steps.html',
  'theclub-DLT.html',
  'contact-DLT.html',
  'music-DLT.html',
  'live.html',
  'live-wpc.html',
  'trendsense.html',
  'provider-dashboard.html',
  'provider-waitlist.html',
  'exchange-provider.html',
  'exchange-category.html',
  'exchange-location.html',
  'exchange-claim.html',
  'bryce-perry-communicator-awards-2026.html',
  'bryce-perry-parkinsons-award-2026.html',
  'pcn-app.html',
  'inner-circle-welcome.html',
]);

function isCandidate(name) {
  return name.endsWith('.html') && !SKIP.has(name);
}

const files = fs.readdirSync(PUBLIC_DIR).filter(isCandidate)
  .map(n => path.join(PUBLIC_DIR, n));

let changed = 0;
let skippedNoHeader = 0;
let alreadyCanonical = 0;

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');

  const hasHeader = HEADER_RE.test(before);
  const hasMobile = MOBILE_NAV_RE.test(before);

  if (!hasHeader) {
    skippedNoHeader++;
    continue;
  }

  // If already at the current canonical version, skip. Bump the version
  // string in CANONICAL_HEADER (data-canonical-nav="vN") whenever the
  // shape of the nav changes so all pages get re-written.
  if (before.includes('data-canonical-nav="v4"')) {
    alreadyCanonical++;
    continue;
  }

  let after = before.replace(HEADER_RE, CANONICAL_HEADER);
  if (hasMobile) {
    after = after.replace(MOBILE_NAV_RE, CANONICAL_MOBILE_NAV);
  } else {
    // Insert the mobile-nav right after the header if there wasn't one
    after = after.replace(CANONICAL_HEADER, CANONICAL_HEADER + '\n\n  ' + CANONICAL_MOBILE_NAV);
  }

  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changed++;
    console.log('updated', path.basename(file));
  }
}

console.log(`\nChanged: ${changed}`);
console.log(`Skipped (no header):       ${skippedNoHeader}`);
console.log(`Skipped (already canonical): ${alreadyCanonical}`);
console.log(`Total candidate files: ${files.length}`);
