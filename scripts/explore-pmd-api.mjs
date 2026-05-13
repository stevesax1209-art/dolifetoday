// Explore PMD Alliance directory structure
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function getPage(url) {
  const r = await fetch(url, { headers });
  return { status: r.status, html: await r.text() };
}

function extractSlugs(html) {
  const re = /href=["']https:\/\/www\.pmdalliance\.org\/listings\/([^"'\/]+)\/?["']/g;
  const slugs = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const s = m[1];
    if (!s.startsWith('category') && !s.startsWith('tag') && s !== 'feed' && s !== 'tags') {
      slugs.add(s);
    }
  }
  return slugs;
}

function extractMaxPage(html) {
  const re = /page\/(\d+)/g;
  let max = 1, m;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

async function getAllSlugsForCategory(cat) {
  const allSlugs = new Set();
  const { html } = await getPage(`https://www.pmdalliance.org/listings/category/${cat}/`);
  const maxPage = extractMaxPage(html);
  for (const s of extractSlugs(html)) allSlugs.add(s);
  console.log(`  ${cat} page 1/${maxPage}: ${allSlugs.size} slugs so far`);

  for (let page = 2; page <= maxPage; page++) {
    const { status, html: ph } = await getPage(`https://www.pmdalliance.org/listings/category/${cat}/page/${page}/`);
    if (status !== 200) { console.log(`  ${cat} page ${page}: status ${status}, stopping`); break; }
    for (const s of extractSlugs(ph)) allSlugs.add(s);
    if (page % 5 === 0) console.log(`  ${cat} page ${page}/${maxPage}: ${allSlugs.size} slugs`);
  }
  return allSlugs;
}

async function main() {
  for (const cat of ['group', 'provider', 'opportunity']) {
    console.log(`\nCategory: ${cat}`);
    const slugs = await getAllSlugsForCategory(cat);
    console.log(`  Total: ${slugs.size} unique listing slugs`);
    // Show first 5
    for (const s of [...slugs].slice(0, 5)) console.log(`    - ${s}`);
  }

  // Now fetch a sample listing to understand data structure
  console.log('\n--- Sample listing ---');
  const { html } = await getPage('https://www.pmdalliance.org/listings/resilience-online/');
  // Extract structured data
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldMatch) {
    console.log('LD+JSON found:', ldMatch[1].substring(0, 1000));
  }
  // Extract geodirectory fields
  const titleM = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
  console.log('Title:', titleM?.[1]?.trim()?.replace(/<[^>]+>/g, ''));

  // Check for JSON-LD or geodirectory data
  const geoM = html.match(/geodir_post_data\s*=\s*(\{[\s\S]*?\});/);
  if (geoM) console.log('GeoDir data:', geoM[1].substring(0, 500));
}

main().catch(e => console.error(e));
