/**
 * Scrape the International Parkinson and Movement Disorder Society (MDS)
 * specialist directory at mds.movementdisorders.org/directory/
 *
 * Outputs data/mds/specialists.json
 *
 * Usage:
 *   node scripts/scrape-mds-directory.mjs
 *   node scripts/scrape-mds-directory.mjs --debug   # logs DOM structure
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const outDir = path.join(process.cwd(), 'data', 'mds');
const jsonOut = path.join(outDir, 'specialists.json');
const DEBUG = process.argv.includes('--debug');

fs.mkdirSync(outDir, { recursive: true });

function parseAddress(raw) {
  // Raw address is a multiline string. Last line is often country, second-to-last
  // may be "City, State ZIP" or "City ZIP"
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return {};

  // Try to identify country (last line if it looks like a country name)
  const knownCountries = new Set([
    'United States', 'Canada', 'United Kingdom', 'Australia', 'New Zealand',
    'Ireland', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium',
    'Sweden', 'Finland', 'Norway', 'Denmark', 'Switzerland', 'Austria',
    'Brazil', 'Argentina', 'Chile', 'Colombia', 'Mexico', 'Uruguay',
    'India', 'China', 'Japan', 'South Korea', 'Taiwan', 'Thailand',
    'Singapore', 'Malaysia', 'Philippines', 'Viet Nam', 'Indonesia',
    'Turkey', 'Israel', 'Egypt', 'South Africa', 'Nigeria', 'Zimbabwe',
    'Russia', 'Ukraine', 'Poland', 'Romania', 'Hungary', 'Serbia',
    'Slovakia', 'Czech Republic', 'Greece', 'Portugal', 'Luxembourg',
    'Qatar', 'United Arab Emirates', 'Saudi Arabia', 'Pakistan',
    'Bangladesh', 'Iran, Islamic Republic of', 'Armenia', 'Georgia',
    'Tanzania, United Republic of', 'Dominican Republic', 'Guatemala',
    'Bolivia', 'Peru', 'Ecuador', 'Honduras', 'Tunisia', 'Hong Kong',
    'Puerto Rico',
  ]);

  let country = '';
  let addrLines = [...lines];

  // Check if last line is a country
  if (knownCountries.has(lines[lines.length - 1])) {
    country = addrLines.pop();
  }

  // Try to parse city/state/zip from the last remaining line
  let city = '';
  let stateProvince = '';
  let postalCode = '';
  let street = '';

  if (addrLines.length > 0) {
    const lastLine = addrLines[addrLines.length - 1];
    // Pattern: "City, ST 12345" or "City, State 12345" or "City 12345"
    const usMatch = lastLine.match(
      /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/
    );
    const caMatch = lastLine.match(
      /^(.+?),\s*([A-Z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/
    );
    const ukMatch = lastLine.match(/^(.+?)\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/);
    const genericCityState = lastLine.match(/^(.+?),\s*(.+?)\s+([\dA-Z][\dA-Z\s-]{2,10})$/);
    const cityZip = lastLine.match(/^(.+?)\s+(\d{4,6})$/);

    const usStates = new Set([
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
      'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
      'TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI',
    ]);
    const caProvinces = new Set([
      'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
    ]);

    if (usMatch) {
      city = usMatch[1];
      stateProvince = usMatch[2];
      postalCode = usMatch[3];
      addrLines.pop();
      // Infer country from state abbreviation
      if (!country && usStates.has(stateProvince)) country = 'United States';
      else if (!country && caProvinces.has(stateProvince)) country = 'Canada';
    } else if (caMatch) {
      city = caMatch[1];
      stateProvince = caMatch[2];
      postalCode = caMatch[3];
      addrLines.pop();
      if (!country) country = 'Canada';
    } else if (ukMatch) {
      city = ukMatch[1];
      postalCode = ukMatch[2];
      addrLines.pop();
      if (!country) country = 'United Kingdom';
    } else if (genericCityState) {
      city = genericCityState[1];
      stateProvince = genericCityState[2];
      postalCode = genericCityState[3];
      addrLines.pop();
      if (!country && usStates.has(stateProvince)) country = 'United States';
      else if (!country && caProvinces.has(stateProvince)) country = 'Canada';
    } else if (cityZip) {
      city = cityZip[1];
      postalCode = cityZip[2];
      addrLines.pop();
    }
  }

  street = addrLines.join(', ');

  return { street, city, stateProvince, postalCode, country };
}

async function scrapeSpecialists() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading MDS Specialist Finder...');
  await page.goto('https://mds.movementdisorders.org/directory/', {
    waitUntil: 'networkidle',
    timeout: 120000,
  });

  // Wait for the results to fully render
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log(`Page title: ${title}`);

  // Extract from .user-container rows (the known DOM structure)
  // Each container has: col-lg-1 (marker), col-lg-6 (name/institution/expertise), col-lg-5 (contact)
  let specialists = await page.evaluate(() => {
    const containers = document.querySelectorAll('.user-container');
    return Array.from(containers).map((container) => {
      const nameEl =
        container.querySelector('h2 strong') || container.querySelector('h2');
      const instEl = container.querySelector('h3');
      const infoP = container.querySelector('.col-lg-6 p');
      const contactCol = container.querySelector('.col-lg-5');
      const phoneEl = contactCol?.querySelector('a[href^="tel:"]');

      // Parse patient types and expertise from the info paragraph
      const infoText = (infoP?.textContent || '').replace(/\s+/g, ' ').trim();
      const ptMatch = infoText.match(
        /Sees patient types?:\s*(.+?)(?:\s*Expertise|$)/
      );
      const expMatch = infoText.match(/Expertise includes?:\s*(.+?)$/);

      // Parse address lines from the contact column
      // The format is: <p><strong>Contact details:</strong><br>Line1<br>Line2<br>...<br><a>phone</a></p>
      let contactRaw = '';
      if (contactCol) {
        const contactP = contactCol.querySelector('p');
        if (contactP) {
          // Get inner HTML and split by <br>
          const html = contactP.innerHTML;
          const parts = html
            .replace(/<strong>.*?<\/strong>/gi, '')
            .replace(/<a[^>]*>.*?<\/a>/gi, '')
            .split(/<br\s*\/?>/gi)
            .map((s) => s.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean);
          contactRaw = parts.join('\n');
        }
      }

      return {
        name: (nameEl?.textContent || '').trim(),
        institution: (instEl?.textContent || '').trim(),
        patientTypes: ptMatch ? ptMatch[1].trim() : '',
        expertise: expMatch ? expMatch[1].trim() : '',
        contactRaw,
        phone: (phoneEl?.textContent || '').trim(),
      };
    });
  });

  console.log(`Extracted ${specialists.length} raw specialists`);

  // Post-process: parse addresses, deduplicate, clean up
  const processed = specialists.map((s, idx) => {
    const addr = parseAddress(s.contactRaw);

    // Parse patient types into array
    const ptArr = s.patientTypes
      .split(/,/)
      .map((t) => t.trim())
      .filter(Boolean);

    // Parse expertise into array
    const expArr = s.expertise
      .split(/,/)
      .map((e) => e.trim())
      .filter(Boolean);

    return {
      sourceId: `mds-${idx}`,
      name: s.name,
      institution: s.institution,
      patientTypes: ptArr,
      expertise: expArr,
      street: addr.street || '',
      city: addr.city || '',
      stateProvince: addr.stateProvince || '',
      postalCode: addr.postalCode || '',
      country: addr.country || '',
      phone: s.phone || '',
      contactRaw: s.contactRaw,
    };
  });

  // Summary stats
  const countryCounts = {};
  for (const s of processed) {
    const c = s.country || 'Unknown';
    countryCounts[c] = (countryCounts[c] || 0) + 1;
  }

  console.log(`\nProcessed ${processed.length} specialists`);
  console.log('\nBy country:');
  Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([country, count]) => {
      console.log(`  ${country}: ${count}`);
    });

  fs.writeFileSync(jsonOut, JSON.stringify(processed, null, 2));
  console.log(`\nSaved to ${jsonOut}`);

  await browser.close();
}

scrapeSpecialists().catch((err) => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
