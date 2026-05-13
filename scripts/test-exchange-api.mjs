// Quick test: what does the public exchange API expose?
async function main() {
  const r = await fetch('https://club.dolifetoday.com/api/exchange/providers?limit=3');
  const d = await r.json();
  console.log('Total count:', d.count);
  console.log('First provider keys:', Object.keys(d.providers[0]).join(', '));
  console.log(JSON.stringify(d.providers[0], null, 2));
}
main().catch(e => console.error(e));
