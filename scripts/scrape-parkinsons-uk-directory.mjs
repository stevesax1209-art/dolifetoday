import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const rootDir = process.cwd();
const listUrl = 'https://www.parkinsons.org.uk/community/groups/list';
const outDir = path.join(rootDir, 'data', 'parkinsons-uk');
const jsonOut = path.join(outDir, 'listings.json');
const csvOut = path.join(outDir, 'listings.csv');
const summaryOut = path.join(outDir, 'summary.json');
const failureOut = path.join(outDir, 'failures.json');
const concurrency = Math.max(1, Number(getArgValue('--concurrency') || '6'));
const limit = Math.max(0, Number(getArgValue('--limit') || '0'));

function getArgValue(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : '';
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function uniq(values) {
  return Array.from(new Set((values || []).map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function toAbsoluteUrl(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  try {
    return new URL(raw, 'https://localsupport.parkinsons.org.uk').href.replace(/^http:\/\//i, 'https://');
  } catch {
    return '';
  }
}

function decodeCfEmail(encoded) {
  const input = normalizeWhitespace(encoded);
  if (!input || input.length < 4) return '';

  let decoded = '';
  const key = parseInt(input.slice(0, 2), 16);
  for (let index = 2; index < input.length; index += 2) {
    const code = parseInt(input.slice(index, index + 2), 16) ^ key;
    decoded += String.fromCharCode(code);
  }
  return decoded;
}

async function fetchText(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; DLT Exchange Importer/1.0; +https://dolifetoday.com)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      return fetchText(url, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function collectListingUrls(html) {
  const matches = html.match(/https?:\/\/localsupport\.parkinsons\.org\.uk\/[^"'\s<]+/gi) || [];
  return uniq(
    matches
      .map((value) => toAbsoluteUrl(value).replace(/[),.;]+$/g, ''))
      .filter((value) => value && !/\/support-search\/?$/i.test(value))
  );
}

function extractTextList($, $root, selector) {
  return uniq(
    $root
      .find(selector)
      .map((_, node) => normalizeWhitespace($(node).text()))
      .get()
  );
}

function extractEmails($, $root) {
  const emails = [];

  $root.find('a[href^="mailto:"]').each((_, node) => {
    const href = normalizeWhitespace($(node).attr('href')).replace(/^mailto:/i, '');
    if (href) emails.push(href);
  });

  $root.find('[data-cfemail]').each((_, node) => {
    const decoded = decodeCfEmail($(node).attr('data-cfemail'));
    if (decoded) emails.push(decoded);
  });

  return uniq(emails.map((value) => value.toLowerCase()));
}

function extractPhones($, $root) {
  const phones = [];

  $root.find('a[href^="tel:"]').each((_, node) => {
    phones.push(normalizeWhitespace($(node).text()) || normalizeWhitespace($(node).attr('href')).replace(/^tel:/i, ''));
  });

  $root.find('.t-local-support-group__contact-row, .t-local-support-activity__contact-number').each((_, node) => {
    const text = normalizeWhitespace($(node).text());
    if (/\+?\d[\d\s()]{6,}/.test(text)) {
      phones.push(text);
    }
  });

  return uniq(phones);
}

function extractAddress($, $root) {
  const lines = uniq(
    $root
      .find('.a-address__line')
      .map((_, node) => normalizeWhitespace($(node).text()))
      .get()
  );

  return {
    lines,
    name: normalizeWhitespace($root.find('.a-address__name').first().text()),
    line1: normalizeWhitespace($root.find('.a-address__line-1').first().text()),
    line2: normalizeWhitespace($root.find('.a-address__line-2').first().text()),
    city: normalizeWhitespace($root.find('.a-address__locality').first().text()),
    postcode: normalizeWhitespace($root.find('.a-address__post-code').first().text()),
    full: lines.join(', '),
  };
}

function parseProviderPage($, url) {
  const linkedActivityUrls = uniq(
    $('.t-local-support-activity-card__link a, .t-local-support-activity-slim-card__link a')
      .map((_, node) => toAbsoluteUrl($(node).attr('href')))
      .get()
  );

  const activitySummaries = $('.t-local-support-activity-card').map((_, node) => {
    const $node = $(node);
    const address = extractAddress($, $node);
    return {
      name: normalizeWhitespace($node.find('.t-local-support-activity-card__name').text()),
      url: toAbsoluteUrl($node.find('.t-local-support-activity-card__link a').attr('href')),
      categories: uniq($node.find('.m-local-support-category-icon__icon').map((__, icon) => normalizeWhitespace($(icon).attr('title') || $(icon).attr('alt'))).get()),
      address: address.full,
      city: address.city,
      postcode: address.postcode,
    };
  }).get();

  const whereCard = $('.t-local-support-group__info-where').first();
  const contactBlocks = $('.t-local-support-group__info-contact').map((_, node) => {
    const $node = $(node);
    return {
      title: normalizeWhitespace($node.find('.t-local-support-group__contact-title').text()),
      rows: uniq($node.find('.t-local-support-group__contact-row').map((__, row) => normalizeWhitespace($(row).text())).get()),
      phones: extractPhones($, $node),
      emails: extractEmails($, $node),
    };
  }).get();

  return {
    url,
    pageType: 'provider',
    sourceDirectory: 'parkinsons-uk-local-support',
    name: normalizeWhitespace($('.t-local-support-group__name').first().text()),
    description: normalizeWhitespace($('.t-local-support-group__description').first().text()),
    locationName: normalizeWhitespace(whereCard.find('.field--name-field-activity-location').first().text()),
    scheduleText: uniq(whereCard.find('.a-local-support-activity-date').map((_, node) => normalizeWhitespace($(node).text())).get()).join(' | '),
    phones: uniq(contactBlocks.flatMap((entry) => entry.phones)),
    emails: uniq(contactBlocks.flatMap((entry) => entry.emails)),
    contactBlockTitles: uniq(contactBlocks.map((entry) => entry.title)),
    contactBlocks,
    linkedActivityUrls,
    activitySummaries,
    categories: uniq(activitySummaries.flatMap((entry) => entry.categories)),
    city: normalizeWhitespace(activitySummaries.find((entry) => entry.city)?.city),
    postcode: normalizeWhitespace(activitySummaries.find((entry) => entry.postcode)?.postcode),
    address: normalizeWhitespace(activitySummaries.find((entry) => entry.address)?.address),
  };
}

function parseActivityPage($, url) {
  const address = extractAddress($, $('.t-local-support-activity__location').first());
  const primaryContact = $('.t-local-support-activity__contact').first();
  const providerUrl = toAbsoluteUrl($('.t-local-support-activity__provider-link a').attr('href'));

  return {
    url,
    pageType: 'activity',
    sourceDirectory: 'parkinsons-uk-local-support',
    name: normalizeWhitespace($('.t-local-support-activity__title').first().text()),
    description: normalizeWhitespace($('.t-local-support-activity__section-description').first().text()),
    categories: uniq($('.m-local-support-category-icon__icon').map((_, node) => normalizeWhitespace($(node).attr('title') || $(node).attr('alt'))).get()),
    scheduleText: uniq($('.a-local-support-activity-date').map((_, node) => normalizeWhitespace($(node).text())).get()).join(' | '),
    cost: normalizeWhitespace($('.field--name-field-activity-payment').first().text()),
    contactName: normalizeWhitespace(primaryContact.find('.t-local-support-activity__contact-name').first().text()),
    phones: extractPhones($, primaryContact),
    emails: extractEmails($, primaryContact),
    locationName: address.name,
    address: address.full,
    addressLine1: address.line1,
    addressLine2: address.line2,
    city: address.city,
    postcode: address.postcode,
    providerName: normalizeWhitespace($('.t-local-support-activity__provider-name').first().text()),
    providerUrl,
  };
}

function parseListingPage(url, html) {
  const $ = cheerio.load(html);
  if ($('.t-local-support-group').length) {
    return parseProviderPage($, url);
  }
  if ($('.t-local-support-activity').length) {
    return parseActivityPage($, url);
  }
  throw new Error('Unknown page structure');
}

async function mapConcurrent(items, worker, maxConcurrency) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length || 1) }, runWorker));
  return results;
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`FETCH ${listUrl}`);
  const listHtml = await fetchText(listUrl);
  let urls = collectListingUrls(listHtml);
  if (limit > 0) {
    urls = urls.slice(0, limit);
  }

  console.log(`FOUND ${urls.length} listing URLs`);

  const failures = [];
  const listings = (await mapConcurrent(
    urls,
    async (url, currentIndex) => {
      console.log(`SCRAPE ${currentIndex + 1}/${urls.length} ${url}`);
      try {
        const html = await fetchText(url);
        return parseListingPage(url, html);
      } catch (error) {
        failures.push({ url, error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    concurrency
  )).filter(Boolean);

  fs.writeFileSync(jsonOut, JSON.stringify(listings, null, 2));

  const headers = [
    'pageType',
    'name',
    'url',
    'description',
    'categories',
    'locationName',
    'address',
    'addressLine1',
    'addressLine2',
    'city',
    'postcode',
    'scheduleText',
    'cost',
    'contactName',
    'phones',
    'emails',
    'providerName',
    'providerUrl',
    'contactBlockTitles',
    'linkedActivityUrls',
  ];

  const csvRows = [headers.join(',')].concat(
    listings.map((entry) =>
      headers
        .map((header) => {
          const value = entry[header];
          if (Array.isArray(value)) return csvEscape(value.join(' | '));
          return csvEscape(value);
        })
        .join(',')
    )
  );

  fs.writeFileSync(csvOut, csvRows.join('\n'), 'utf8');
  fs.writeFileSync(failureOut, JSON.stringify(failures, null, 2));

  const summary = {
    source: listUrl,
    totalDiscoveredUrls: urls.length,
    totalScraped: listings.length,
    totalFailures: failures.length,
    byPageType: Object.entries(
      listings.reduce((acc, entry) => {
        acc[entry.pageType] = (acc[entry.pageType] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
    withPhone: listings.filter((entry) => Array.isArray(entry.phones) && entry.phones.length > 0).length,
    withEmail: listings.filter((entry) => Array.isArray(entry.emails) && entry.emails.length > 0).length,
    withAddress: listings.filter((entry) => normalizeWhitespace(entry.address)).length,
    uniqueCities: uniq(listings.map((entry) => entry.city)).length,
  };

  fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));

  console.log(`WROTE ${jsonOut}`);
  console.log(`WROTE ${csvOut}`);
  console.log(`WROTE ${summaryOut}`);
  console.log(`WROTE ${failureOut}`);
  console.log(`SCRAPED ${listings.length} listings`);
  console.log(`FAILED ${failures.length} listings`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});