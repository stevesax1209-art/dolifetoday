import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const inputPath = path.join(rootDir, 'data', 'parkinsons-uk', 'listings.json');
const outputJsonPath = path.join(rootDir, 'data', 'parkinsons-uk', 'exchange-import.json');
const outputCsvPath = path.join(rootDir, 'data', 'parkinsons-uk', 'exchange-import.csv');
const summaryPath = path.join(rootDir, 'data', 'parkinsons-uk', 'exchange-import-summary.json');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferTypeInfo(entry) {
  const categories = uniqueStrings(entry.categories || []).map((value) => value.toLowerCase());
  const haystack = `${entry.pageType || ''} ${categories.join(' ')} ${entry.description || ''}`.toLowerCase();

  if (categories.includes('exercise') || haystack.includes('exercise')) {
    return {
      typeLabel: 'Exercise Class',
      specialties: ['Exercise', 'Parkinson\'s Care'],
    };
  }

  if (categories.includes('support') || haystack.includes('support group') || haystack.includes('friendship and support')) {
    return {
      typeLabel: 'Support Group',
      specialties: ['Support Group', 'Parkinson\'s Care'],
    };
  }

  return {
    typeLabel: 'Community Resource',
    specialties: ['Community Resource', 'Parkinson\'s Care'],
  };
}

function inferFormats(entry) {
  const categories = uniqueStrings(entry.categories || []);
  const hasOnline = categories.some((value) => /online|virtual/i.test(value));
  const hasInPerson = categories.some((value) => /in-person|in person/i.test(value));

  if (hasOnline && hasInPerson) return ['hybrid'];
  if (hasOnline) return ['virtual'];
  if (hasInPerson) return ['in-person'];
  return ['in-person'];
}

function buildLocationLabel(entry) {
  const parts = [];
  if (normalizeWhitespace(entry.city)) parts.push(normalizeWhitespace(entry.city));
  parts.push('United Kingdom');
  return uniqueStrings(parts).join(', ');
}

function buildDescription(entry) {
  const parts = [normalizeWhitespace(entry.description)];

  if (normalizeWhitespace(entry.scheduleText)) {
    parts.push(`Schedule: ${normalizeWhitespace(entry.scheduleText)}.`);
  }

  if (normalizeWhitespace(entry.address)) {
    parts.push(`Location: ${normalizeWhitespace(entry.address)}.`);
  }

  if (Array.isArray(entry.contactBlocks) && entry.contactBlocks.length > 0) {
    const contacts = entry.contactBlocks
      .map((block) => normalizeWhitespace(block.title))
      .filter(Boolean)
      .join(', ');
    if (contacts) {
      parts.push(`Contacts available: ${contacts}.`);
    }
  }

  return uniqueStrings(parts).join(' ');
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const normalized = raw
  .filter((entry) => normalizeWhitespace(entry?.name))
  .map((entry) => {
    const sourceId = normalizeWhitespace(entry.url).replace(/^https?:\/\//i, '');
    const typeInfo = inferTypeInfo(entry);
    const slug = slugify([
      entry.name,
      entry.pageType,
      entry.postcode || entry.city || sourceId,
    ].filter(Boolean).join(' '));

    return {
      sourceSystem: 'parkinsons-uk',
      sourceDirectory: 'Parkinson\'s UK Local Support',
      sourceId,
      slug,
      name: normalizeWhitespace(entry.name),
      typeLabel: typeInfo.typeLabel,
      excerpt: normalizeWhitespace(entry.description) || `Imported from Parkinson's UK local support directory for ${normalizeWhitespace(entry.city) || 'the United Kingdom'}.`,
      description: buildDescription(entry),
      location: buildLocationLabel(entry),
      locationLabel: buildLocationLabel(entry),
      country: 'United Kingdom',
      specialties: uniqueStrings([...(entry.categories || []), ...typeInfo.specialties]),
      languages: [],
      formats: inferFormats(entry),
      verified: true,
      listingStatus: 'official_directory_import',
      reviewCount: 0,
      rating: 0,
      website: normalizeWhitespace(entry.url),
      email: uniqueStrings(entry.emails || [])[0] || '',
      phone: uniqueStrings(entry.phones || [])[0] || '',
      organizationName: normalizeWhitespace(entry.locationName),
      credentials: '',
      rawRole: normalizeWhitespace(entry.pageType),
      rawOrganization: 'Parkinson\'s UK',
      sourceLocation: normalizeWhitespace(entry.address) || buildLocationLabel(entry),
      city: normalizeWhitespace(entry.city),
      stateProvince: '',
      postcode: normalizeWhitespace(entry.postcode),
      sourceUrl: normalizeWhitespace(entry.url),
      scrapedAt: new Date().toISOString(),
    };
  });

fs.writeFileSync(outputJsonPath, JSON.stringify(normalized, null, 2));

const csvHeaders = [
  'sourceSystem',
  'sourceDirectory',
  'sourceId',
  'slug',
  'name',
  'typeLabel',
  'excerpt',
  'description',
  'location',
  'locationLabel',
  'country',
  'specialties',
  'languages',
  'formats',
  'verified',
  'listingStatus',
  'reviewCount',
  'rating',
  'website',
  'email',
  'phone',
  'organizationName',
  'credentials',
  'rawRole',
  'rawOrganization',
  'sourceLocation',
  'city',
  'postcode',
  'sourceUrl',
  'scrapedAt',
];

const csvRows = [csvHeaders.join(',')].concat(
  normalized.map((entry) =>
    csvHeaders
      .map((header) => {
        const value = entry[header];
        if (Array.isArray(value)) {
          return csvEscape(value.join(' | '));
        }
        return csvEscape(value);
      })
      .join(',')
  )
);

fs.writeFileSync(outputCsvPath, csvRows.join('\n'), 'utf8');

const summary = {
  total: normalized.length,
  byType: Object.entries(
    normalized.reduce((acc, entry) => {
      acc[entry.typeLabel] = (acc[entry.typeLabel] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]),
  withPhone: normalized.filter((entry) => normalizeWhitespace(entry.phone)).length,
  withEmail: normalized.filter((entry) => normalizeWhitespace(entry.email)).length,
  withWebsite: normalized.filter((entry) => normalizeWhitespace(entry.website)).length,
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`WROTE ${outputJsonPath}`);
console.log(`WROTE ${outputCsvPath}`);
console.log(`WROTE ${summaryPath}`);
console.log(`NORMALIZED ${normalized.length} records`);