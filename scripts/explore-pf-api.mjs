// Explore Parkinson's Foundation "In Your Area" API
const baseUrl = 'https://www.parkinson.org/api/map';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.parkinson.org/resources-support/in-your-area',
};

async function explore() {
  const url = `${baseUrl}?zip=66952&radius=2500&type=`;
  const res = await fetch(url, { headers });
  const data = await res.json();
  
  console.log('Total locations:', data.locations?.length);
  
  // Show first unknown rendered HTML to understand type encoding
  const unknowns = data.locations?.filter(l => {
    const m = l.rendered?.match(/class="eyebrow">([^<]+)/);
    return !m;
  });
  console.log('Unknown count:', unknowns?.length);
  if (unknowns?.length > 0) {
    console.log('\nFirst unknown full rendered HTML:');
    console.log(unknowns[0].rendered);
    console.log('\n--- Second unknown:');
    console.log(unknowns[1]?.rendered);
  }
  
  // Try different radius: does 5000 miles get more?
  const url2 = `${baseUrl}?zip=66952&radius=5000&type=`;
  const res2 = await fetch(url2, { headers });
  const data2 = await res2.json();
  console.log('\nWith radius=5000:', data2.locations?.length);
  
  // Try international: check non-US entries in data
  const intl = data.locations?.filter(l => {
    const zipMatch = l.zip;
    return zipMatch && !/^\d{5}$/.test(zipMatch);
  });
  console.log('Non-US ZIP entries:', intl?.length);
  if (intl?.length > 0) {
    for (const l of intl.slice(0, 3)) {
      console.log(' -', l.title, 'zip:', l.zip);
    }
  }
}

explore().catch(e => console.error(e));
