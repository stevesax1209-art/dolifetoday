import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const inputPath = path.join(rootDir, 'data', 'apda', 'pages.json');
const outputJsonPath = path.join(rootDir, 'data', 'apda', 'exchange-import.json');
const outputCsvPath = path.join(rootDir, 'data', 'apda', 'exchange-import.csv');
const summaryPath = path.join(rootDir, 'data', 'apda', 'exchange-import-summary.json');

const dropUrlPatterns = [
  /\/about/i,
  /\/contact-us/i,
  /\/our-team/i,
  /\/board/i,
  /\/career/i,
  /\/volunteer/i,
  /\/ways[-/]/i,
  /\/donate/i,
  /\/mailing-list/i,
  /\/newsletter/i,
  /\/in-the-news/i,
  /\/community-grant-program/i,
  /\/optimism-walk/i,
  /\/fundraising/i,
  /\/sponsor/i,
  /\/add-me-to/i,
  /\/at-home-activities/i,
  /\/clinical-studies/i,
  /\/past-events/i,
  /\/past-programs/i,
  /\/patientaid/i,
];

const dropNamePatterns = [
  /^we.?re glad you want to connect/i,
  /^tips for safe at-home exercise/i,
  /^research happening regionally/i,
  /^past programs? (and|&) events/i,
  /^stay connected with virtual events/i,
  /^don.?t miss out on our upcoming events/i,
];

const dropSourceIds = new Set([
  'www.apdaparkinson.org/community/connecticut/press-parkinsons-roadmap-for-education-and-support-services/',
]);

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

function shouldKeep(entry) {
  const url = normalizeWhitespace(entry.url);
  if (!url) return false;
  if (dropSourceIds.has(url.replace(/^https?:\/\//i, '').replace(/\/+$/, '/') )) return false;
  if (dropUrlPatterns.some((pattern) => pattern.test(url))) return false;

  const currentName = normalizeWhitespace(entry.name);
  if (dropNamePatterns.some((pattern) => pattern.test(currentName))) return false;

  const haystack = [
    entry.pageType,
    entry.name,
    ...(entry.headings || []),
    ...(entry.sections || []).map((section) => `${section.heading} ${section.body}`),
  ].join(' ').toLowerCase();

  if (/support group|exercise|wellness|newly diagnosed|care partner|caregiver|information and referral|information & referral|press|art|dance|yoga|resource|resources|event|education|publication|helpful links/i.test(haystack)) {
    return true;
  }

  return ['support-groups', 'referral-center-page', 'state-resource-page', 'events'].includes(normalizeWhitespace(entry.pageType));
}

function inferTypeInfo(entry) {
  const haystack = [
    entry.pageType,
    entry.name,
    ...(entry.headings || []),
    ...(entry.sections || []).map((section) => `${section.heading} ${section.body}`),
  ].join(' ').toLowerCase();

  if (/information and referral|information & referral|referral center|wellness center/i.test(haystack)) {
    return {
      typeLabel: 'Referral Center',
      specialties: ['Information and Referral', 'Parkinson\'s Care'],
    };
  }

  if (/support group|care partners? group|caregivers? group/i.test(haystack) || entry.pageType === 'support-groups') {
    return {
      typeLabel: 'Support Group',
      specialties: ['Support Group', 'Parkinson\'s Care'],
    };
  }

  if (/exercise|dance|yoga|movement|fitness|pwr/i.test(haystack)) {
    return {
      typeLabel: 'Exercise Program',
      specialties: ['Exercise', 'Wellness', 'Parkinson\'s Care'],
    };
  }

  if (/event|conference|webinar|program|education|press/i.test(haystack) || entry.pageType === 'events') {
    return {
      typeLabel: 'Education Event',
      specialties: ['Education', 'Community Event', 'Parkinson\'s Care'],
    };
  }

  return {
    typeLabel: 'Community Resource',
    specialties: ['Community Resource', 'Parkinson\'s Care'],
  };
}

function inferFormats(entry) {
  const text = [
    entry.contentSnippet,
    ...(entry.sections || []).map((section) => section.body),
  ].join(' ').toLowerCase();

  const hasVirtual = /zoom|virtual|online|google meet/i.test(text);
  const hasInPerson = /in person|presencial|location:|room:|address:/i.test(text);

  if (hasVirtual && hasInPerson) return ['hybrid'];
  if (hasVirtual) return ['virtual'];
  return ['in-person'];
}

function pickDisplayName(entry) {
  const headings = uniqueStrings(entry.headings || []);
  const preferredHeading = headings.find((heading) => /information and referral|information & referral|referral center|wellness center/i.test(heading))
    || headings.find((heading) => /support group|exercise|wellness|newly diagnosed|care partner|caregiver|press|event|resources?/i.test(heading)
      && !/^welcome to /i.test(heading)
      && !/^apda resources in /i.test(heading)
      && !/^chapter menu$/i.test(heading)
      && !/^help our community$/i.test(heading)
      && !dropNamePatterns.some((pattern) => pattern.test(heading)));

  if (preferredHeading) return preferredHeading;

  const cleaned = normalizeWhitespace(entry.name)
    .replace(/^Welcome to the APDA\s+/i, 'APDA ')
    .replace(/\s+Resource Page$/i, '')
    .trim();

  return cleaned || normalizeWhitespace(entry.title);
}

function parseLocation(entry) {
  if (normalizeWhitespace(entry.pageType) === 'state-resource-page' || /\/community\/[^/]+\/?$/i.test(normalizeWhitespace(entry.url))) {
    return {
      city: '',
      stateProvince: normalizeWhitespace(entry.state),
      postcode: '',
      locationLabel: `${normalizeWhitespace(entry.state)}, United States`,
    };
  }

  const text = [
    ...(entry.sections || []).map((section) => `${section.heading} ${section.body}`),
    entry.contentSnippet,
  ].join(' ');

  const matches = Array.from(text.matchAll(/(?:^|\s)([A-Z][A-Za-z .'-]+?),\s([A-Z]{2})\s(\d{5}(?:-\d{4})?)/g));
  const match = matches.length > 0 ? matches[matches.length - 1] : null;

  if (match) {
    const cleanedCity = normalizeWhitespace(match[1]).replace(/^.*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)$/, '$1');
    return {
      city: cleanedCity,
      stateProvince: normalizeWhitespace(match[2]),
      postcode: normalizeWhitespace(match[3]),
      locationLabel: `${cleanedCity}, ${normalizeWhitespace(match[2])}, United States`,
    };
  }

  return {
    city: '',
    stateProvince: normalizeWhitespace(entry.state),
    postcode: '',
    locationLabel: `${normalizeWhitespace(entry.state)}, United States`,
  };
}

function buildDescription(entry) {
  const text = uniqueStrings(
    (entry.sections || [])
      .slice(0, 4)
      .map((section) => `${normalizeWhitespace(section.heading)} ${normalizeWhitespace(section.body)}`)
  ).join(' ');

  return normalizeWhitespace(text || entry.contentSnippet);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const normalized = raw
  .filter((entry) => shouldKeep(entry))
  .map((entry) => {
    const typeInfo = inferTypeInfo(entry);
    const location = parseLocation(entry);
    const urlBits = normalizeWhitespace(entry.url).replace(/^https?:\/\//i, '');
    const name = pickDisplayName(entry);

    return {
      sourceSystem: 'apda-community',
      sourceDirectory: 'APDA Community',
      sourceId: urlBits,
      slug: slugify([entry.stateSlug, name, location.postcode || entry.pageType].filter(Boolean).join(' ')),
      name,
      typeLabel: typeInfo.typeLabel,
      excerpt: normalizeWhitespace((entry.sections || [])[0]?.body) || `Imported from APDA ${normalizeWhitespace(entry.state)} community resources.`,
      description: buildDescription(entry),
      location: location.locationLabel,
      locationLabel: location.locationLabel,
      country: 'United States',
      specialties: uniqueStrings([...(entry.headings || []), ...typeInfo.specialties]).slice(0, 10),
      languages: /español|spanish/i.test(buildDescription(entry)) ? ['English', 'Spanish'] : [],
      formats: inferFormats(entry),
      verified: true,
      listingStatus: 'official_directory_import',
      reviewCount: 0,
      rating: 0,
      website: normalizeWhitespace(entry.canonicalUrl || entry.url),
      email: uniqueStrings(entry.emails || [])[0] || '',
      phone: uniqueStrings(entry.phones || [])[0] || '',
      organizationName: `APDA ${normalizeWhitespace(entry.state)}`,
      credentials: '',
      rawRole: normalizeWhitespace(entry.pageType),
      rawOrganization: 'American Parkinson Disease Association',
      sourceLocation: location.locationLabel,
      city: location.city,
      stateProvince: location.stateProvince,
      postcode: location.postcode,
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
  'rawRole',
  'rawOrganization',
  'sourceLocation',
  'city',
  'stateProvince',
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
  byState: Object.entries(
    normalized.reduce((acc, entry) => {
      acc[entry.stateProvince || '(unknown)'] = (acc[entry.stateProvince || '(unknown)'] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]),
  withPhone: normalized.filter((entry) => normalizeWhitespace(entry.phone)).length,
  withEmail: normalized.filter((entry) => normalizeWhitespace(entry.email)).length,
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`WROTE ${outputJsonPath}`);
console.log(`WROTE ${outputCsvPath}`);
console.log(`WROTE ${summaryPath}`);
console.log(`NORMALIZED ${normalized.length} records`);