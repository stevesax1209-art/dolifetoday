(function () {
  'use strict';

  const API_ENDPOINT = 'https://club.dolifetoday.com/api/exchange/providers?limit=10000&v=20260327-1';

  const searchInput = document.getElementById('exchange-search');
  const countrySelect = document.getElementById('exchange-country');
  const typeSelect = document.getElementById('exchange-type');
  const statusNode = document.getElementById('exchange-status');
  const resultsNode = document.getElementById('exchange-results');

  if (!searchInput || !countrySelect || !typeSelect || !statusNode || !resultsNode) {
    return;
  }

  let allProviders = [];

  function buildProviderDetailUrl(provider) {
    if (provider && provider.detailPagePath) {
      return provider.detailPagePath;
    }

    const slug = provider && provider.slug ? provider.slug : '';
    return '/exchange/provider/' + encodeURIComponent(slug);
  }

  function buildProviderClaimUrl(provider) {
    if (provider && provider.claimPagePath) {
      return provider.claimPagePath;
    }

    if (provider && provider.claimUrl) {
      return provider.claimUrl;
    }

    const slug = provider && provider.slug ? provider.slug : '';
    return '/exchange/provider/' + encodeURIComponent(slug) + '/claim';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isVisibleSpecialty(value) {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    return normalized && normalized.indexOf('carefund') === -1 && normalized.indexOf('pdiq') === -1;
  }

  function getVisibleSpecialties(provider) {
    return (provider.specialties || []).filter(isVisibleSpecialty);
  }

  function buildOptions(select, values, placeholder) {
    const fragment = document.createDocumentFragment();
    const firstOption = document.createElement('option');
    firstOption.value = 'all';
    firstOption.textContent = placeholder;
    fragment.appendChild(firstOption);

    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      fragment.appendChild(option);
    });

    select.innerHTML = '';
    select.appendChild(fragment);
  }

  function getFilteredProviders() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    const country = countrySelect.value;
    const type = typeSelect.value;

    return allProviders.filter((provider) => {
      if (country !== 'all' && provider.country !== country) {
        return false;
      }

      if (type !== 'all' && provider.typeLabel !== type) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        provider.name,
        provider.excerpt,
        provider.location,
        provider.typeLabel,
        getVisibleSpecialties(provider).join(' '),
        (provider.languages || []).join(' '),
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });
  }

  function renderProviders() {
    const filteredProviders = getFilteredProviders();
    statusNode.textContent = filteredProviders.length === 1
      ? '1 provider shown'
      : filteredProviders.length + ' providers shown';

    if (!filteredProviders.length) {
      resultsNode.innerHTML = '<article class="card exchange-empty-state"><h3>No providers match this filter</h3><p>Try a different city, specialty, or provider type.</p></article>';
      return;
    }

    resultsNode.innerHTML = filteredProviders.map((provider) => {
      const initial = escapeHtml((provider.name || '?').charAt(0).toUpperCase());
      const detailUrl = buildProviderDetailUrl(provider);
      const claimUrl = buildProviderClaimUrl(provider);
      const mark = provider.logo
        ? '<div class="exchange-card-mark"><img src="' + escapeHtml(provider.logo) + '" alt="' + escapeHtml(provider.name) + ' logo"></div>'
        : '<div class="exchange-card-mark">' + initial + '</div>';

      const ratingLabel = provider.reviewCount > 0
        ? provider.rating.toFixed(1) + ' rating from ' + provider.reviewCount + ' reviews'
        : 'Community listing';

      const badges = ((provider.publicBadges || []).length ? provider.publicBadges : [provider.typeLabel, provider.location])
        .concat((provider.formats || []).slice(0, 2).map((format) => format.replace('-', ' ')))
        .map((badge) => '<span class="exchange-badge">' + escapeHtml(badge) + '</span>')
        .join('');

      const tags = getVisibleSpecialties(provider).slice(0, 4)
        .map((tag) => '<span class="exchange-tag">' + escapeHtml(tag) + '</span>')
        .join('');

      const websiteButton = provider.website
        ? '<a class="btn btn-outline-primary" href="' + escapeHtml(provider.website) + '" target="_blank" rel="noopener noreferrer">Visit Website</a>'
        : '<a class="btn btn-outline-primary" href="' + escapeHtml(provider.joinClubUrl) + '">Open In The Club</a>';

      const detailButton = '<a class="btn btn-outline-primary" href="' + escapeHtml(detailUrl) + '">View Details</a>';

      const verifiedBadge = provider.verified
        ? '<span class="exchange-badge">Verified</span>'
        : '';

      return [
        '<article class="card exchange-card">',
        '  <div class="exchange-card-top">',
             mark,
        '    <div class="exchange-card-heading">',
           '      <h3><a class="exchange-card-link" href="' + escapeHtml(detailUrl) + '">' + escapeHtml(provider.name) + '</a></h3>',
        '      <p class="exchange-card-meta">' + escapeHtml(ratingLabel) + '</p>',
        '    </div>',
        '  </div>',
        '  <div class="exchange-card-badges">' + verifiedBadge + badges + '</div>',
        '  <p class="exchange-card-copy">' + escapeHtml(provider.excerpt) + '</p>',
        tags ? '  <div class="exchange-card-tags">' + tags + '</div>' : '',
        '  <div class="exchange-card-actions">',
           detailButton,
        websiteButton,
           '    <a class="btn btn-primary" href="' + escapeHtml(claimUrl) + '">Claim This Listing</a>',
        '  </div>',
        '</article>',
      ].join('');
    }).join('');
  }

  function bindFilters() {
    [searchInput, countrySelect, typeSelect].forEach((node) => {
      node.addEventListener('input', renderProviders);
      node.addEventListener('change', renderProviders);
    });
  }

  fetch(API_ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Unable to load providers');
      }
      return response.json();
    })
    .then((payload) => {
      allProviders = Array.isArray(payload.providers) ? payload.providers : [];

      const countries = Array.from(new Set(allProviders.map((provider) => provider.country).filter(Boolean))).sort();
      const types = Array.from(new Set(allProviders.map((provider) => provider.typeLabel).filter(Boolean))).sort();

      buildOptions(countrySelect, countries, 'All countries');
      buildOptions(typeSelect, types, 'All provider types');
      bindFilters();
      renderProviders();
    })
    .catch(() => {
      statusNode.textContent = 'The Exchange is temporarily unavailable.';
      resultsNode.innerHTML = '<article class="card exchange-empty-state"><h3>Unable to load providers right now</h3><p>Please try again shortly or open The Club directly.</p><p><a class="btn btn-primary" href="https://club.dolifetoday.com/?publicExchange=true">Open The Club Directory</a></p></article>';
    });
})();