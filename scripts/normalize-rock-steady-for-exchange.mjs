import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const inputPath = path.join(rootDir, 'data', 'rock-steady', 'listings.json');
const outputJsonPath = path.join(rootDir, 'data', 'rock-steady', 'exchange-import.json');
const outputCsvPath = path.join(rootDir, 'data', 'rock-steady', 'exchange-import.csv');
const summaryPath = path.join(rootDir, 'data', 'rock-steady', 'exchange-import-summary.json');

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

function hasRockSteadyPrefix(value) {
  return /^rock steady boxing\b/i.test(normalizeWhitespace(value));
}

function isLikelyPersonName(value) {
  const text = normalizeWhitespace(value);
  if (!text) return false;
  if (/\d/.test(text)) return false;

  const normalized = text
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;

  const organizationKeywords = new Set([
    'and',
    'associates',
    'balance',
    'boxing',
    'care',
    'center',
    'centre',
    'clinic',
    'fitness',
    'gym',
    'health',
    'hospital',
    'institute',
    'medical',
    'movement',
    'neuro',
    'performance',
    'physical',
    'physio',
    'physiotherapy',
    'pt',
    'rehab',
    'services',
    'speech',
    'therapy',
    'university',
    'wellness',
  ]);

  return words.every((word) => {
    const cleaned = word.replace(/[^A-Za-z'’-]/g, '');
    if (!cleaned) return false;
    if (organizationKeywords.has(cleaned.toLowerCase())) return false;
    return /^[A-Z][A-Za-z'’-]+$/.test(cleaned);
  });
}

function isRockSteadyProgramEntry(entry) {
  return entry.directoryKey === 'member-directory' || entry.directoryKey === 'international-directory';
}

function isRockSteadyClinicianEntry(entry) {
  return entry.directoryKey === 'clinician-directory';
}

function buildPrefixedRockSteadyProgramName(value) {
  const text = normalizeWhitespace(value);
  return text ? `Rock Steady Boxing - ${text}` : 'Rock Steady Boxing';
}

function looksLikePostcode(value) {
  const text = normalizeWhitespace(value);
  if (!text) return false;

  return /^\d{4,10}(?:-\d{4})?$/.test(text)
    || /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/i.test(text)
    || /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(text);
}

function looksLikeStateProvince(value, country) {
  const text = normalizeWhitespace(value);
  if (!text) return false;
  if (text.toLowerCase() === normalizeWhitespace(country).toLowerCase()) return false;
  return /^[A-Z]{2}$/.test(text) || /^[A-Za-z .'-]+$/.test(text);
}

function parseStateProvinceAndPostcode(value, country) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return { stateProvince: '', postcode: '' };
  }

  const tokens = text.split(' ').filter(Boolean);
  for (let index = 1; index < tokens.length; index += 1) {
    const stateCandidate = tokens.slice(0, index).join(' ');
    const postcodeCandidate = tokens.slice(index).join(' ');
    if (looksLikeStateProvince(stateCandidate, country) && looksLikePostcode(postcodeCandidate)) {
      return {
        stateProvince: stateCandidate,
        postcode: postcodeCandidate,
      };
    }
  }

  if (looksLikeStateProvince(text, country)) {
    return { stateProvince: text, postcode: '' };
  }

  return { stateProvince: '', postcode: '' };
}

function parseAddress(entry) {
  const address = normalizeWhitespace(entry.address);
  const parts = address.split(',').map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length === 0) {
    return {
      city: '',
      stateProvince: '',
      postcode: '',
      country: entry.directoryKey === 'international-directory' ? '' : 'United States',
    };
  }

  const defaultCountry = entry.directoryKey === 'international-directory' ? '' : 'United States';
  let country = defaultCountry;
  let trailingParts = [...parts];

  if (trailingParts.length > 0) {
    const lastPart = trailingParts[trailingParts.length - 1];
    if (/^[A-Za-z .'-]+$/.test(lastPart) && !/^suite\b/i.test(lastPart)) {
      country = lastPart;
      trailingParts = trailingParts.slice(0, -1);
    }
  }

  const stateAndPostcode = trailingParts.length > 0 ? trailingParts[trailingParts.length - 1] : '';
  const parsedState = parseStateProvinceAndPostcode(stateAndPostcode, country);
  const stateProvince = parsedState.stateProvince;
  const postcode = parsedState.postcode;
  const city = trailingParts.length > 1 ? trailingParts[trailingParts.length - 2] : '';

  return {
    city,
    stateProvince,
    postcode,
    country,
  };
}

function buildLocationLabel(addressInfo) {
  const parts = [];
  if (addressInfo.city) parts.push(addressInfo.city);
  if (addressInfo.stateProvince) parts.push(addressInfo.stateProvince);
  if (addressInfo.country) parts.push(addressInfo.country);
  return uniqueStrings(parts).join(', ');
}

function normalizeRockSteadyComparableValue(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isLocationLikeRockSteadyName(value, addressInfo) {
  const normalizedValue = normalizeRockSteadyComparableValue(value);
  if (!normalizedValue) {
    return false;
  }

  const candidates = [
    addressInfo.city,
    addressInfo.stateProvince,
    addressInfo.country,
    addressInfo.city && addressInfo.stateProvince ? `${addressInfo.city} ${addressInfo.stateProvince}` : '',
    addressInfo.city && addressInfo.country ? `${addressInfo.city} ${addressInfo.country}` : '',
    addressInfo.stateProvince && addressInfo.country ? `${addressInfo.stateProvince} ${addressInfo.country}` : '',
  ];

  return candidates
    .map((candidate) => normalizeRockSteadyComparableValue(candidate))
    .filter(Boolean)
    .includes(normalizedValue);
}

function isLowQualityRockSteadyName(value, addressInfo) {
  const text = normalizeWhitespace(value);
  if (!text) return true;
  if (/^rock steady boxing\b/i.test(text)) return false;
  if (/^\d+$/.test(text)) return true;
  if (/^\d+\s+/.test(text)) return true;
  if (isLocationLikeRockSteadyName(text, addressInfo)) return true;
  return false;
}

function buildLocationBasedRockSteadyName(addressInfo) {
  const parts = [];

  if (addressInfo.city) {
    parts.push(addressInfo.city);
  }

  if (addressInfo.stateProvince && addressInfo.country === 'United States') {
    parts.push(addressInfo.stateProvince);
  } else if (!addressInfo.city && addressInfo.stateProvince) {
    parts.push(addressInfo.stateProvince);
  } else if (!addressInfo.city && !addressInfo.stateProvince && addressInfo.country) {
    parts.push(addressInfo.country);
  }

  return parts.length > 0
    ? `Rock Steady Boxing ${parts.join(', ')}`
    : 'Rock Steady Boxing';
}

function resolveProviderName(entry, addressInfo) {
  const categoryName = uniqueStrings(entry.categories || []).find((value) => /rock steady boxing/i.test(value));
  if (categoryName) {
    return categoryName;
  }

  const rawName = normalizeWhitespace(entry.name);
  if (isRockSteadyClinicianEntry(entry) && isLikelyPersonName(rawName)) {
    return buildLocationBasedRockSteadyName(addressInfo);
  }

  if (!isLowQualityRockSteadyName(rawName, addressInfo)) {
    if (isRockSteadyProgramEntry(entry) && !hasRockSteadyPrefix(rawName)) {
      return buildPrefixedRockSteadyProgramName(rawName);
    }

    return rawName;
  }

  const mapName = normalizeWhitespace(entry.mapName);
  if (!isLowQualityRockSteadyName(mapName, addressInfo)) {
    return mapName;
  }

  return buildLocationBasedRockSteadyName(addressInfo);
}

function inferTypeInfo(entry) {
  const labels = uniqueStrings(entry.categories || []).map((value) => value.toLowerCase());
  const haystack = `${entry.directoryKey} ${entry.name} ${labels.join(' ')}`.toLowerCase();

  if (entry.directoryKey === 'clinician-directory') {
    if (/speech|slp/i.test(haystack)) return { typeLabel: 'Speech Therapy', specialties: ['Speech Therapy', 'Parkinson\'s Care'] };
    if (/occupational/i.test(haystack)) return { typeLabel: 'Occupational Therapy', specialties: ['Occupational Therapy', 'Parkinson\'s Care'] };
    if (/physical|physio|rehab/i.test(haystack)) return { typeLabel: 'Physical Therapy', specialties: ['Physical Therapy', 'Parkinson\'s Care'] };
    return { typeLabel: 'Rehab Professional', specialties: ['Rehab Professional', 'Parkinson\'s Care'] };
  }

  if (/boxing|exercise|fitness|gym|wellness|yoga|movement/i.test(haystack)) {
    return { typeLabel: 'Exercise Program', specialties: ['Boxing', 'Exercise', 'Parkinson\'s Care'] };
  }

  return { typeLabel: 'Community Program', specialties: ['Community Program', 'Parkinson\'s Care'] };
}

function buildDescription(entry) {
  const resolvedName = resolveProviderName(entry, parseAddress(entry));
  const parts = [
    `${resolvedName} is listed in the official ${normalizeWhitespace(entry.sourceDirectory)}.`,
  ];

  if (entry.categories?.length) {
    parts.push(`Categories: ${uniqueStrings(entry.categories).join(', ')}.`);
  }

  if (normalizeWhitespace(entry.address)) {
    parts.push(`Address: ${normalizeWhitespace(entry.address)}.`);
  }

  return parts.join(' ');
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const normalized = raw
  .filter((entry) => normalizeWhitespace(entry.name))
  .map((entry) => {
    const addressInfo = parseAddress(entry);
    const typeInfo = inferTypeInfo(entry);
    const locationLabel = buildLocationLabel(addressInfo) || normalizeWhitespace(entry.address) || normalizeWhitespace(entry.mapName);
    const resolvedName = resolveProviderName(entry, addressInfo);

    return {
      sourceSystem: 'rock-steady-boxing',
      sourceDirectory: normalizeWhitespace(entry.sourceDirectory),
      sourceId: normalizeWhitespace(entry.sourceId),
      slug: normalizeWhitespace(entry.slug) || slugify(`${resolvedName} ${entry.sourceId}`),
      name: resolvedName,
      typeLabel: typeInfo.typeLabel,
      excerpt: `${resolvedName} is listed in the official Rock Steady Boxing directory.`,
      description: buildDescription(entry),
      location: locationLabel,
      locationLabel,
      country: addressInfo.country || (entry.directoryKey === 'international-directory' ? '' : 'United States'),
      specialties: uniqueStrings([...(entry.categories || []), ...typeInfo.specialties]).slice(0, 12),
      languages: [],
      formats: ['in-person'],
      verified: false,
      listingStatus: 'unclaimed',
      reviewCount: 0,
      rating: 0,
      website: normalizeWhitespace(entry.website),
      email: '',
      phone: normalizeWhitespace(entry.phone),
      organizationName: resolvedName,
      credentials: entry.directoryKey === 'clinician-directory' ? 'Rock Steady Boxing clinician directory' : '',
      rawRole: normalizeWhitespace(entry.directoryKey),
      rawOrganization: 'Rock Steady Boxing',
      sourceLocation: normalizeWhitespace(entry.address) || locationLabel,
      city: addressInfo.city,
      stateProvince: addressInfo.stateProvince,
      postcode: addressInfo.postcode,
      sourceUrl: normalizeWhitespace(entry.detailsUrl || entry.sourceUrl),
      latitude: Number.isFinite(Number(entry.latitude)) ? Number(entry.latitude) : null,
      longitude: Number.isFinite(Number(entry.longitude)) ? Number(entry.longitude) : null,
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
  'stateProvince',
  'postcode',
  'sourceUrl',
  'latitude',
  'longitude',
  'scrapedAt',
];

const csvRows = [csvHeaders.join(',')].concat(
  normalized.map((entry) =>
    csvHeaders
      .map((header) => {
        const value = entry[header];
        if (Array.isArray(value)) return csvEscape(value.join(' | '));
        return csvEscape(value);
      })
      .join(',')
  )
);

fs.writeFileSync(outputCsvPath, csvRows.join('\n'), 'utf8');

const summary = {
  total: normalized.length,
  byDirectory: Object.entries(
    normalized.reduce((acc, entry) => {
      acc[entry.sourceDirectory] = (acc[entry.sourceDirectory] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]),
  byType: Object.entries(
    normalized.reduce((acc, entry) => {
      acc[entry.typeLabel] = (acc[entry.typeLabel] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]),
  withWebsite: normalized.filter((entry) => normalizeWhitespace(entry.website)).length,
  withPhone: normalized.filter((entry) => normalizeWhitespace(entry.phone)).length,
  withCoordinates: normalized.filter((entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude)).length,
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`WROTE ${outputJsonPath}`);
console.log(`WROTE ${outputCsvPath}`);
console.log(`WROTE ${summaryPath}`);
console.log(`NORMALIZED ${normalized.length} records`);