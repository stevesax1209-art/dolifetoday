import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const rootDir = process.cwd();
const rootUrl = 'https://www.apdaparkinson.org/community/';
const origin = 'https://www.apdaparkinson.org';
const outDir = path.join(rootDir, 'data', 'apda');
const jsonOut = path.join(outDir, 'pages.json');
const csvOut = path.join(outDir, 'pages.csv');
const summaryOut = path.join(outDir, 'summary.json');
const failureOut = path.join(outDir, 'failures.json');
const concurrency = Math.max(1, Number(getArgValue('--concurrency') || '6'));
const limitStates = Math.max(0, Number(getArgValue('--limit-states') || '0'));
const limitPages = Math.max(0, Number(getArgValue('--limit-pages') || '0'));

const excludedPrefixes = [
  '/about',
  '/advocacy',
  '/apda-symptom-tracker',
  '/blog',
  '/contact',
  '/dashboard',
  '/disclosure-statement',
  '/doctor-blogs',
  '/donate',
  '/get-involved',
  '/living-with-parkinsons-disease',
  '/news',
  '/national-resources-support',
  '/privacy-policy',
  '/research',
  '/resources',
  '/resources-support',
  '/terms-of-use',
  '/upcoming-events',
  '/what-is-parkinsons',
  '/wp-',
  '/wp-admin',
];

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

function uniq(values) {
  return Array.from(new Set((values || []).map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function toAbsoluteUrl(value) {
  const raw = normalizeWhitespace(value);
  if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('#')) {
    return '';
  }

  try {
    return new URL(raw, origin).href.replace(/^http:\/\//i, 'https://');
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; DLT APDA Importer/1.0; +https://dolifetoday.com)',
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await sleep(attempt * 1500);
      return fetchText(url, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/';
    }
    return parsed.href;
  } catch {
    return normalizeWhitespace(url);
  }
}

function isBinaryAsset(pathname) {
  return /\.(?:pdf|jpe?g|png|gif|webp|svg|docx?|xlsx?|pptx?|zip)$/i.test(pathname);
}

function shouldExcludePath(pathname) {
  return excludedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function shouldCrawlUrl(url, stateSlug, anchorText = '', contextText = '') {
  if (!url) return false;
  if (url.includes('@')) return false;

  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return false;
    if (parsed.hash && !parsed.pathname) return false;
    if (isBinaryAsset(parsed.pathname)) return false;
    if (shouldExcludePath(parsed.pathname)) return false;
    if (parsed.pathname === '/' || parsed.pathname === '/community/') return false;

    if (parsed.searchParams.get('post_type') === 'chapter-content-page') {
      return true;
    }

    const normalizedPath = parsed.pathname.replace(/\/+$/, '/');
    if (normalizedPath.includes('__trashed')) return false;
    if (/(?:^|\/)(?:ways-to-give|ways-give|ways-to-donate|ways-donate|other-ways-to-give|donate|donatemontly|donate-monthly|sponsor|volunteer|fundraising-events|optimism-walk|virginiaoptimismwalk)(?:\/|$)/i.test(normalizedPath)) {
      return false;
    }

    const statePrefix = `/community/${stateSlug}/`;
    const stateAltPrefix = `/community/${stateSlug}-`;
    if (normalizedPath === statePrefix || normalizedPath.startsWith(statePrefix) || normalizedPath.startsWith(stateAltPrefix)) {
      return true;
    }

    if (!normalizedPath.startsWith('/community/')) {
      if (normalizedPath.startsWith('/events/')) {
        return false;
      }

      const combinedText = `${anchorText} ${contextText}`.toLowerCase();
      const hasLocalContext = /(information\s*&\s*referral|support group|support groups|program|programs|wellness center|resource page|chapter menu)/i.test(combinedText);
      const hasResourcePath = /(support|group|groups|program|programs|wellness|center|centers|referral|chapter)/i.test(normalizedPath);
      return hasLocalContext && hasResourcePath;
    }

    return false;
  } catch {
    return false;
  }
}

function collectStateEntries(html) {
  const $ = cheerio.load(html);
  const options = $('#map_chapter_select_drp option')
    .map((_, node) => ({
      slug: normalizeWhitespace($(node).attr('value')).toLowerCase(),
      name: normalizeWhitespace($(node).text()),
    }))
    .get()
    .filter((entry) => entry.slug && entry.slug !== 'none_select' && entry.name);

  return options.map((entry) => ({
    ...entry,
    url: normalizeUrl(`${origin}/community/${entry.slug}/`),
  }));
}

function getContentRoot($) {
  const candidates = [
    '.entry-content',
    '.site-main article .entry-content',
    'main article',
    'article',
  ];

  for (const selector of candidates) {
    const match = $(selector).first();
    if (match.length) {
      return match.clone();
    }
  }

  return $('body').first().clone();
}

function cleanContent($content) {
  $content.find('script, style, noscript, iframe, form, button, svg').remove();
  $content.find('.breadcrumbs, .search-box-wrapper, .footerDonateBox, .widget.notice').remove();
  return $content;
}

function extractEmails($, $root) {
  const emails = [];

  $root.find('a[href^="mailto:"]').each((_, node) => {
    const href = normalizeWhitespace($(node).attr('href')).replace(/^mailto:/i, '');
    if (href) emails.push(href.split('?')[0]);
  });

  return uniq(emails.map((value) => value.toLowerCase()));
}

function extractPhones($, $root) {
  const phones = [];

  $root.find('a[href^="tel:"]').each((_, node) => {
    const text = normalizeWhitespace($(node).text()) || normalizeWhitespace($(node).attr('href')).replace(/^tel:/i, '');
    if (text) phones.push(text);
  });

  return uniq(phones);
}

function extractSections($, $root) {
  const sections = [];
  let current = { heading: 'Overview', bodyParts: [] };

  const nodes = $root.find('h1, h2, h3, h4, p, li').toArray();
  for (const node of nodes) {
    const $node = $(node);
    const text = normalizeWhitespace($node.text());
    if (!text) continue;

    const tag = String(node.tagName || '').toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      if (current.heading || current.bodyParts.length) {
        const body = uniq(current.bodyParts).join(' ');
        if (current.heading !== 'Overview' || body) {
          sections.push({ heading: current.heading, body });
        }
      }
      current = { heading: text, bodyParts: [] };
      continue;
    }

    current.bodyParts.push(text);
  }

  const finalBody = uniq(current.bodyParts).join(' ');
  if (current.heading !== 'Overview' || finalBody) {
    sections.push({ heading: current.heading, body: finalBody });
  }

  return sections.filter((entry) => entry.heading || entry.body);
}

function inferPageType(url, headings, title) {
  const haystack = [url, title, ...headings].join(' ').toLowerCase();
  if (haystack.includes('post_type=chapter-content-page')) return 'chapter-content-page';
  if (haystack.includes('support group')) return 'support-groups';
  if (haystack.includes('upcoming events') || /\/events?\//.test(url)) return 'events';
  if (haystack.includes('resource page')) return 'state-resource-page';
  if (haystack.includes('information & referral') || haystack.includes('wellness center')) return 'referral-center-page';
  return 'resource-page';
}

function collectDiscoveryLinks($, $root, stateSlug) {
  const urls = [];

  $root.find('a[href]').each((_, node) => {
    const $node = $(node);
    const absoluteUrl = toAbsoluteUrl($node.attr('href'));
    const anchorText = normalizeWhitespace($node.text());
    const contextText = normalizeWhitespace(
      $node.closest('p, li, div, section').prevAll('h1, h2, h3, h4').first().text() ||
      $node.parent().prevAll('h1, h2, h3, h4').first().text()
    );

    if (shouldCrawlUrl(absoluteUrl, stateSlug, anchorText, contextText)) {
      urls.push(normalizeUrl(absoluteUrl));
    }
  });

  return uniq(urls);
}

function parsePage(meta, html) {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($('title').first().text());
  const canonical = normalizeWhitespace($('link[rel="canonical"]').attr('href'));
  const $content = cleanContent(getContentRoot($));

  const headings = uniq($content.find('h1, h2, h3, h4').map((_, node) => normalizeWhitespace($(node).text())).get());
  const sections = extractSections($, $content);
  const phones = extractPhones($, $content);
  const emails = extractEmails($, $content);
  const discoveryLinks = collectDiscoveryLinks($, $content, meta.stateSlug);
  const contentText = normalizeWhitespace($content.text());

  const chapterMenuLinks = uniq(
    $content
      .find('a[href]')
      .map((_, node) => {
        const label = normalizeWhitespace($(node).text());
        const href = normalizeUrl(toAbsoluteUrl($(node).attr('href')));
        return label && href ? `${label} -> ${href}` : '';
      })
      .get()
  ).slice(0, 50);

  return {
    state: meta.stateName,
    stateSlug: meta.stateSlug,
    url: meta.url,
    canonicalUrl: canonical || meta.url,
    title,
    name: headings[0] || title,
    pageType: inferPageType(meta.url, headings, title),
    headings,
    phones,
    emails,
    sections,
    discoveryLinks,
    chapterMenuLinks,
    contentSnippet: contentText.slice(0, 1000),
  };
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

  console.log(`FETCH ${rootUrl}`);
  const rootHtml = await fetchText(rootUrl);
  let states = collectStateEntries(rootHtml);
  if (limitStates > 0) {
    states = states.slice(0, limitStates);
  }

  console.log(`FOUND ${states.length} states`);

  const queue = states.map((entry) => ({
    stateSlug: entry.slug,
    stateName: entry.name,
    url: entry.url,
  }));
  const enqueued = new Set(queue.map((entry) => entry.url));
  const visited = new Set();
  const failures = [];
  const pages = [];

  while (queue.length > 0) {
    if (limitPages > 0 && pages.length >= limitPages) {
      break;
    }

    const remaining = limitPages > 0 ? Math.max(0, limitPages - pages.length) : queue.length;
    const batch = queue.splice(0, Math.min(queue.length, remaining || queue.length, concurrency * 3));

    const results = await mapConcurrent(
      batch,
      async (meta, currentIndex) => {
        console.log(`SCRAPE ${pages.length + currentIndex + 1} ${meta.url}`);
        try {
          const html = await fetchText(meta.url);
          const page = parsePage(meta, html);
          return { meta, page };
        } catch (error) {
          failures.push({
            state: meta.stateName,
            url: meta.url,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      },
      concurrency
    );

    for (const result of results.filter(Boolean)) {
      const { meta, page } = result;
      if (visited.has(meta.url)) continue;
      visited.add(meta.url);
      pages.push(page);

      for (const discoveredUrl of page.discoveryLinks) {
        if (visited.has(discoveredUrl) || enqueued.has(discoveredUrl)) {
          continue;
        }
        enqueued.add(discoveredUrl);
        queue.push({
          stateSlug: meta.stateSlug,
          stateName: meta.stateName,
          url: discoveredUrl,
        });
      }
    }
  }

  fs.writeFileSync(jsonOut, JSON.stringify(pages, null, 2));

  const headers = [
    'state',
    'stateSlug',
    'pageType',
    'name',
    'url',
    'canonicalUrl',
    'title',
    'headings',
    'phones',
    'emails',
    'discoveryLinks',
    'chapterMenuLinks',
    'contentSnippet',
  ];

  const csvRows = [headers.join(',')].concat(
    pages.map((entry) =>
      headers
        .map((header) => {
          const value = entry[header];
          if (Array.isArray(value)) {
            return csvEscape(
              value
                .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
                .join(' | ')
            );
          }
          return csvEscape(value);
        })
        .join(',')
    )
  );

  fs.writeFileSync(csvOut, csvRows.join('\n'), 'utf8');
  fs.writeFileSync(failureOut, JSON.stringify(failures, null, 2));

  const summary = {
    source: rootUrl,
    totalStates: states.length,
    totalPages: pages.length,
    totalFailures: failures.length,
    withPhone: pages.filter((entry) => entry.phones.length > 0).length,
    withEmail: pages.filter((entry) => entry.emails.length > 0).length,
    byPageType: Object.entries(
      pages.reduce((acc, entry) => {
        acc[entry.pageType] = (acc[entry.pageType] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
    byState: Object.entries(
      pages.reduce((acc, entry) => {
        acc[entry.state] = (acc[entry.state] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
  };

  fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));

  console.log(`WROTE ${jsonOut}`);
  console.log(`WROTE ${csvOut}`);
  console.log(`WROTE ${summaryOut}`);
  console.log(`WROTE ${failureOut}`);
  console.log(`SCRAPED ${pages.length} pages`);
  console.log(`FAILED ${failures.length} pages`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});