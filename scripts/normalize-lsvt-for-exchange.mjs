import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const inputPath = path.join(rootDir, 'data', 'lsvt', 'clinicians.json');
const outputJsonPath = path.join(rootDir, 'data', 'lsvt', 'exchange-import.json');
const outputCsvPath = path.join(rootDir, 'data', 'lsvt', 'exchange-import.csv');
const summaryPath = path.join(rootDir, 'data', 'lsvt', 'exchange-import-summary.json');

const COUNTRY_BY_SOURCE = {
  'New York, NY': 'United States',
  'Los Angeles, CA': 'United States',
  'Chicago, IL': 'United States',
  'Houston, TX': 'United States',
  'Miami, FL': 'United States',
  'Seattle, WA': 'United States',
  'Toronto, ON': 'Canada',
  'Vancouver, BC': 'Canada',
  'Montreal, QC': 'Canada',
  'Mexico City, Mexico': 'Mexico',
  'Sao Paulo, Brazil': 'Brazil',
  'Buenos Aires, Argentina': 'Argentina',
  'London, UK': 'United Kingdom',
  'Dublin, Ireland': 'Ireland',
  'Paris, France': 'France',
  'Madrid, Spain': 'Spain',
  'Berlin, Germany': 'Germany',
  'Rome, Italy': 'Italy',
  'Amsterdam, Netherlands': 'Netherlands',
  'Stockholm, Sweden': 'Sweden',
  'Warsaw, Poland': 'Poland',
  'Istanbul, Turkey': 'Turkey',
  'Tel Aviv, Israel': 'Israel',
  'Dubai, UAE': 'United Arab Emirates',
  'Cairo, Egypt': 'Egypt',
  'Johannesburg, South Africa': 'South Africa',
  'Mumbai, India': 'India',
  'Delhi, India': 'India',
  'Singapore': 'Singapore',
  'Tokyo, Japan': 'Japan',
  'Seoul, South Korea': 'South Korea',
  'Sydney, Australia': 'Australia',
  'Melbourne, Australia': 'Australia',
  'Auckland, New Zealand': 'New Zealand',
};

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function compact(array) {
  return array.filter(Boolean);
}

function titleCase(value) {
  return normalizeWhitespace(value)
    .split(' ')
    .map((part) => {
      if (!part) return '';
      if (/^[A-Z]{2,3}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function splitOrganization(rawOrganization, sourceLocation) {
  const organization = normalizeWhitespace(rawOrganization);
  if (!organization || organization === 'NA -' || organization === 'NA' || organization === '-') {
    return {
      organizationName: '',
      locationText: normalizeWhitespace(sourceLocation),
    };
  }

  const marker = organization.lastIndexOf(' - ');
  if (marker === -1) {
    return {
      organizationName: organization,
      locationText: normalizeWhitespace(sourceLocation),
    };
  }

  const organizationName = normalizeWhitespace(organization.slice(0, marker));
  const locationText = normalizeWhitespace(organization.slice(marker + 3)) || normalizeWhitespace(sourceLocation);

  return { organizationName, locationText };
}

function inferCountry(sourceLocation) {
  return COUNTRY_BY_SOURCE[sourceLocation] || '';
}

function inferType(rawRole, credentials) {
  const role = normalizeWhitespace(rawRole).toLowerCase();
  const creds = normalizeWhitespace(credentials).toLowerCase();
  const combined = role + ' ' + creds;

  if (combined.includes('speech')) {
    return {
      typeLabel: 'Speech Therapy',
      shortTypeLabel: 'Speech Therapy',
      specialties: ['LSVT LOUD', 'Speech Therapy', 'Parkinson\'s Care'],
      publicBadges: ['LSVT Certified'],
    };
  }

  if (combined.includes('occupational')) {
    return {
      typeLabel: 'Occupational Therapy',
      shortTypeLabel: 'Occupational Therapy',
      specialties: ['LSVT BIG', 'Occupational Therapy', 'Parkinson\'s Care'],
      publicBadges: ['LSVT Certified'],
    };
  }

  if (combined.includes('coach')) {
    return {
      typeLabel: 'Exercise Coaching',
      shortTypeLabel: 'Exercise Coaching',
      specialties: ['BIG for LIFE', 'Exercise Coaching', 'Parkinson\'s Care'],
      publicBadges: ['LSVT Certified'],
    };
  }

  if (
    combined.includes('physical') ||
    combined.includes('physio') ||
    combined.includes('pta') ||
    combined.includes('pt ') ||
    combined.endsWith('pt') ||
    combined.includes('physical therapy')
  ) {
    return {
      typeLabel: 'Physical Therapy',
      shortTypeLabel: 'Physical Therapy',
      specialties: ['LSVT BIG', 'Physical Therapy', 'Parkinson\'s Care'],
      publicBadges: ['LSVT Certified'],
    };
  }

  return {
    typeLabel: 'Parkinson\'s Rehabilitation',
    shortTypeLabel: 'Parkinson\'s Rehabilitation',
    specialties: ['LSVT Certified', 'Parkinson\'s Care'],
    publicBadges: ['LSVT Certified'],
  };
}

function buildExcerpt(entry) {
  const parts = [];
  if (entry.typeLabel) parts.push(entry.typeLabel);
  parts.push('listing sourced from the official LSVT Global directory');
  if (entry.organizationName) parts.push('for ' + entry.organizationName);
  if (entry.locationLabel) parts.push('in ' + entry.locationLabel);
  return normalizeWhitespace(parts.join(' ')) + '.';
}

function buildDescription(entry) {
  const parts = [
    `${entry.name} is listed in the official LSVT Global clinician directory.`,
  ];

  if (entry.rawRole) {
    parts.push(`Role: ${entry.rawRole}.`);
  }
  if (entry.credentials) {
    parts.push(`Credentials: ${entry.credentials}.`);
  }
  if (entry.organizationName) {
    parts.push(`Organization: ${entry.organizationName}.`);
  }
  if (entry.locationLabel) {
    parts.push(`Location: ${entry.locationLabel}.`);
  }
  if (entry.country) {
    parts.push(`Country: ${entry.country}.`);
  }

  parts.push('This record should be reviewed before public publication to confirm contact details, website, and listing copy.');
  return parts.join(' ');
}

function dedupe(array) {
  return Array.from(new Set(array.map((item) => normalizeWhitespace(item)).filter(Boolean)));
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const normalized = raw.map((row) => {
  const sourceLocation = normalizeWhitespace(row.sourceLocation);
  const { organizationName, locationText } = splitOrganization(row.organization, sourceLocation);
  const country = inferCountry(sourceLocation);
  const typeInfo = inferType(row.role, row.credentials);
  const locationLabel = titleCase(locationText || sourceLocation);
  const baseSlug = slugify([row.name, organizationName || locationLabel || sourceLocation, row.dataId].filter(Boolean).join(' '));

  const entry = {
    sourceSystem: 'lsvt-global',
    sourceDirectory: 'LSVT Global Clinician Directory',
    sourceId: normalizeWhitespace(row.dataId),
    slug: baseSlug,
    name: normalizeWhitespace(row.name),
    typeLabel: typeInfo.typeLabel,
    shortTypeLabel: typeInfo.shortTypeLabel,
    excerpt: '',
    description: '',
    location: locationLabel,
    locationLabel,
    country,
    specialties: dedupe(typeInfo.specialties),
    languages: [],
    formats: [],
    publicBadges: dedupe(typeInfo.publicBadges),
    verified: true,
    listingStatus: 'official_directory_import',
    reviewCount: 0,
    rating: 0,
    logo: '',
    website: normalizeWhitespace(row.website),
    email: normalizeWhitespace(row.email).toLowerCase(),
    phone: normalizeWhitespace(row.phone),
    organizationName,
    credentials: normalizeWhitespace(row.credentials),
    rawRole: normalizeWhitespace(row.role),
    rawOrganization: normalizeWhitespace(row.organization),
    sourceLocation,
    foundCountForLocation: Number(row.foundCountForLocation) || 0,
    scrapedAt: normalizeWhitespace(row.scrapedAt),
    joinClubUrl: 'https://club.dolifetoday.com/?publicExchange=true',
  };

  entry.detailPagePath = '/exchange/provider/' + entry.slug;
  entry.claimPagePath = '/exchange/provider/' + entry.slug + '/claim';
  entry.claimUrl = entry.claimPagePath;
  entry.claimAppUrl = 'https://club.dolifetoday.com/?publicExchange=true';
  entry.detailAppUrl = entry.joinClubUrl;
  entry.excerpt = buildExcerpt(entry);
  entry.description = buildDescription(entry);

  return entry;
});

const jsonHeaders = [
  'sourceSystem',
  'sourceDirectory',
  'sourceId',
  'slug',
  'name',
  'typeLabel',
  'shortTypeLabel',
  'excerpt',
  'description',
  'location',
  'locationLabel',
  'country',
  'specialties',
  'languages',
  'formats',
  'publicBadges',
  'verified',
  'listingStatus',
  'reviewCount',
  'rating',
  'logo',
  'website',
  'email',
  'phone',
  'organizationName',
  'credentials',
  'rawRole',
  'rawOrganization',
  'sourceLocation',
  'foundCountForLocation',
  'scrapedAt',
  'detailPagePath',
  'claimPagePath',
  'claimUrl',
  'claimAppUrl',
  'detailAppUrl',
  'joinClubUrl',
];

fs.writeFileSync(outputJsonPath, JSON.stringify(normalized, null, 2));

const csvHeaders = [
  'sourceSystem',
  'sourceDirectory',
  'sourceId',
  'slug',
  'name',
  'typeLabel',
  'shortTypeLabel',
  'excerpt',
  'description',
  'location',
  'locationLabel',
  'country',
  'specialties',
  'languages',
  'formats',
  'publicBadges',
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
  'foundCountForLocation',
  'scrapedAt',
  'detailPagePath',
  'claimPagePath',
  'claimUrl',
  'claimAppUrl',
  'detailAppUrl',
  'joinClubUrl',
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
  countries: Object.entries(
    normalized.reduce((acc, entry) => {
      acc[entry.country || '(blank)'] = (acc[entry.country || '(blank)'] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]),
  typeLabels: Object.entries(
    normalized.reduce((acc, entry) => {
      acc[entry.typeLabel] = (acc[entry.typeLabel] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]),
  missingWebsite: normalized.filter((entry) => !entry.website).length,
  missingEmail: normalized.filter((entry) => !entry.email).length,
  missingPhone: normalized.filter((entry) => !entry.phone).length,
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`WROTE ${outputJsonPath}`);
console.log(`WROTE ${outputCsvPath}`);
console.log(`WROTE ${summaryPath}`);
console.log(`NORMALIZED ${normalized.length} records`);
