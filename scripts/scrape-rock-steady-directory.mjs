import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const rootDir = process.cwd();
const outputDir = path.join(rootDir, 'data', 'rock-steady');
const outputPath = path.join(outputDir, 'listings.json');
const summaryPath = path.join(outputDir, 'summary.json');

const directories = [
  {
    key: 'member-directory',
    sourceDirectory: 'Rock Steady Boxing Member Directory',
    typeLabel: 'Exercise Program',
    url: 'https://members.rocksteadyboxing.org/member-directory/FindStartsWith?term=%23%21',
  },
  {
    key: 'international-directory',
    sourceDirectory: 'Rock Steady Boxing International Directory',
    typeLabel: 'Exercise Program',
    url: 'https://members.rocksteadyboxing.org/internationaldirectory/FindStartsWith?term=%23%21',
  },
  {
    key: 'clinician-directory',
    sourceDirectory: 'Rock Steady Boxing Clinician Directory',
    typeLabel: 'Rehab Professional',
    url: 'https://members.rocksteadyboxing.org/rsbcliniciandirectory/FindStartsWith?term=%23%21',
  },
];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function ensureAbsoluteUrl(value) {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (/^(tel:|mailto:)/i.test(text)) return text;
  if (text.startsWith('//')) return `https:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text.replace(/^\/+/, '')}`;
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractLocations(html) {
  const match = html.match(/var\s+locations\s*=\s*(\[[\s\S]*?\]);/i);
  if (!match) return [];

  try {
    const raw = JSON.parse(match[1]);
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.warn('Unable to parse locations array:', error.message);
    return [];
  }
}

function parseCard($, card, directory) {
  const hash = normalizeWhitespace(card.attr('hash'));
  const titleNode = card.find('.card-title').first();
  const title = normalizeWhitespace(titleNode.text());

  const links = card.find('a').map((index, element) => {
    const node = $(element);
    return {
      href: ensureAbsoluteUrl(node.attr('href')),
      text: normalizeWhitespace(node.text()),
    };
  }).get();

  const items = card.find('.list-group-item').map((index, element) => normalizeWhitespace($(element).text())).get();
  const mapLink = links.find((entry) => /google\.com\/maps/i.test(entry.href));
  const phoneLink = links.find((entry) => /^tel:/i.test(entry.href));
  const websiteLink = links.find((entry) => /visit website/i.test(entry.text));
  const detailsLink = links.find((entry) => /more details/i.test(entry.text)) || links.find((entry) => /\/Details\//i.test(entry.href));

  const address = mapLink?.text || items.find((item) => /,/.test(item) && !/^\(?\d{3}\)?[-\s]?\d{3}/.test(item)) || '';
  const phone = phoneLink ? phoneLink.href.replace(/^tel:/i, '') : '';
  const categories = items.find((item) => item.includes(',') && item !== address) || '';

  return {
    hash,
    name: title,
    address,
    phone,
    website: websiteLink?.href || '',
    detailsUrl: detailsLink?.href || '',
    contactUrl: links.find((entry) => /\/Contact\//i.test(entry.href))?.href || '',
    categories: categories
      .split(',')
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean),
    sourceDirectory: directory.sourceDirectory,
    directoryKey: directory.key,
    typeLabel: directory.typeLabel,
    sourceUrl: directory.url,
  };
}

async function scrapeDirectory(directory) {
  const response = await fetch(directory.url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${directory.key}: ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);
  const locationMap = new Map(
    extractLocations(html)
      .filter((entry) => normalizeWhitespace(entry?.HashedContactId))
      .map((entry) => [normalizeWhitespace(entry.HashedContactId), entry])
  );

  const cards = $('[hash]').map((index, element) => parseCard($, $(element), directory)).get();

  return cards
    .filter((entry) => entry.hash && entry.name)
    .map((entry) => {
      const location = locationMap.get(entry.hash);
      const detailId = entry.detailsUrl.split('/').filter(Boolean).pop() || entry.hash;

      return {
        ...entry,
        sourceId: `${directory.key}:${detailId}`,
        slug: slugify(`${directory.key} ${entry.name} ${entry.address || entry.hash}`),
        latitude: Number.isFinite(Number(location?.Latitude)) ? Number(location.Latitude) : null,
        longitude: Number.isFinite(Number(location?.Longitude)) ? Number(location.Longitude) : null,
        mapName: normalizeWhitespace(location?.Name) || entry.name,
      };
    });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const allListings = [];
  for (const directory of directories) {
    const listings = await scrapeDirectory(directory);
    allListings.push(...listings);
    console.log(`${directory.key}: ${listings.length}`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(allListings, null, 2));

  const summary = {
    total: allListings.length,
    byDirectory: Object.entries(
      allListings.reduce((acc, entry) => {
        acc[entry.directoryKey] = (acc[entry.directoryKey] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
    withWebsite: allListings.filter((entry) => normalizeWhitespace(entry.website)).length,
    withPhone: allListings.filter((entry) => normalizeWhitespace(entry.phone)).length,
    withAddress: allListings.filter((entry) => normalizeWhitespace(entry.address)).length,
    withCoordinates: allListings.filter((entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude)).length,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`WROTE ${outputPath}`);
  console.log(`WROTE ${summaryPath}`);
  console.log(`SCRAPED ${allListings.length} records`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});