// Check PMD Alliance sitemap for listing URLs
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function main() {
  // Try sitemap
  for (const url of [
    'https://www.pmdalliance.org/sitemap_index.xml',
    'https://www.pmdalliance.org/sitemap.xml',
    'https://www.pmdalliance.org/gd_place-sitemap.xml',
    'https://www.pmdalliance.org/wp-sitemap.xml',
  ]) {
    const r = await fetch(url, { headers });
    const text = await r.text();
    const short = url.split('.org/')[1];
    console.log(`${short}: status=${r.status} len=${text.length}`);
    if (r.status === 200 && text.length < 50000) {
      // Extract sitemap URLs
      const sitemapUrls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
      console.log('  URLs:', sitemapUrls.length);
      for (const u of sitemapUrls.slice(0, 20)) console.log('  -', u);
    } else if (r.status === 200) {
      // Large - just find listing URLs
      const listingUrls = [...text.matchAll(/<loc>(https:\/\/www\.pmdalliance\.org\/listings\/[^<]+)<\/loc>/g)].map(m => m[1]);
      console.log('  Listing URLs:', listingUrls.length);
      for (const u of listingUrls.slice(0, 10)) console.log('  -', u);
    }
  }
}

main().catch(e => console.error(e));
