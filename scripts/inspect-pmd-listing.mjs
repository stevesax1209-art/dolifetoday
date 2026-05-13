// Inspect a single PMD Alliance listing page HTML structure
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function main() {
  const url = 'https://www.pmdalliance.org/listings/resilience-online/';
  console.log('Fetching:', url);
  const r = await fetch(url, { headers });
  const html = await r.text();
  console.log('HTML length:', html.length);

  // Find all geodir-related class names
  const classRe = /class="([^"]*(?:geodir|gd-)[^"]*)"/g;
  const classes = new Set();
  let m;
  while ((m = classRe.exec(html)) !== null) classes.add(m[1].substring(0, 120));
  console.log('\nGeoDir classes found:', classes.size);
  for (const c of classes) console.log(' ', c);

  // Find category links
  const catRe = /\/listings\/category\/([^"'\/]+)/g;
  const cats = new Set();
  while ((m = catRe.exec(html)) !== null) cats.add(m[1]);
  console.log('\nCategory links:', [...cats].join(', '));

  // Find JSON-LD
  const ldRe = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1]);
      console.log('\nJSON-LD:', JSON.stringify(j, null, 2).substring(0, 1200));
    } catch {}
  }

  // Find geodir output location section
  const locM = html.match(/class="geodir-output-location([\s\S]{0,3000})/);
  if (locM) console.log('\nLocation output:', locM[0].substring(0, 1000));

  // Find detail
  const detM = html.match(/class="geodir-post-meta-container([\s\S]{0,5000})/);
  if (detM) console.log('\nMeta container:', detM[0].substring(0, 1500));

  // Find any data-lat, data-lng
  const latM = html.match(/data-lat="([^"]+)"/);
  const lngM = html.match(/data-lng="([^"]+)"/);
  console.log('\nLat:', latM?.[1], 'Lng:', lngM?.[1]);
  
  // Search for geodir_cf_ custom fields
  const cfRe = /geodir[-_](?:cf[-_]|i-)([a-zA-Z0-9_-]+)/g;
  const cfs = new Set();
  while ((m = cfRe.exec(html)) !== null) cfs.add(m[1]);
  console.log('\nCustom fields:', [...cfs].join(', '));
  
  // Find the area around category text
  const catArea = html.match(/gd_placecategory|post_category|listing-cat/g);
  console.log('\nCategory patterns:', catArea?.length);
  
  // Try extracting from breadcrumbs or other navigational elements
  const bcM = html.match(/class="[^"]*breadcrumb[^"]*"[\s\S]{0,500}/);
  if (bcM) console.log('\nBreadcrumb:', bcM[0].substring(0, 300));
}

main().catch(e => console.error(e));
