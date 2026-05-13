async function main() {
  const r = await fetch('https://club.dolifetoday.com/api/exchange/providers?limit=1');
  const d = await r.json();
  console.log('API count:', d.count);
}
main();
