(function () {
  'use strict';

  const API_URL = 'https://club.dolifetoday.com/api/exchange/providers?limit=10000&v=20260327-1';
  const loadingNode = document.getElementById('exchange-location-loading');
  const errorNode = document.getElementById('exchange-location-error');
  const contentNode = document.getElementById('exchange-location-content');

  if (!loadingNode || !errorNode || !contentNode) {
    return;
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

  function setVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function extractSlug() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const locationIndex = parts.indexOf('location');
    if (locationIndex === -1 || !parts[locationIndex + 1]) {
      return '';
    }
    return decodeURIComponent(parts[locationIndex + 1]);
  }

  function updateCanonical(url) {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.setAttribute('href', url);
  }

  function renderCard(provider) {
    const ratingLabel = provider.reviewCount > 0
      ? provider.rating.toFixed(1) + ' rating from ' + provider.reviewCount + ' reviews'
      : 'Public Exchange listing';

    const tags = getVisibleSpecialties(provider).slice(0, 4)
      .map(function (tag) {
        return '<span class="exchange-tag">' + escapeHtml(tag) + '</span>';
      })
      .join('');

    const mark = provider.logo
      ? '<div class="exchange-card-mark"><img src="' + escapeHtml(provider.logo) + '" alt="' + escapeHtml(provider.name) + ' logo"></div>'
      : '<div class="exchange-card-mark">' + escapeHtml((provider.name || '?').charAt(0).toUpperCase()) + '</div>';

    return [
      '<article class="card exchange-collection-card">',
      '  <div class="exchange-collection-card-top">',
      mark,
      '    <div class="exchange-collection-card-heading">',
      '      <h3><a class="exchange-card-link" href="' + escapeHtml(provider.detailPagePath || '/exchange') + '">' + escapeHtml(provider.name) + '</a></h3>',
      '      <p class="exchange-card-meta">' + escapeHtml([provider.typeLabel, provider.locationLabel || provider.location, ratingLabel].filter(Boolean).join(' · ')) + '</p>',
      '    </div>',
      '  </div>',
      '  <p class="exchange-collection-summary">' + escapeHtml(provider.excerpt || provider.description || '') + '</p>',
      tags ? '  <div class="exchange-card-tags">' + tags + '</div>' : '',
      '  <div class="exchange-card-actions">',
      '    <a class="btn btn-outline-primary" href="' + escapeHtml(provider.detailPagePath || '/exchange') + '">View Details</a>',
      '    <a class="btn btn-primary" href="' + escapeHtml(provider.claimPagePath || provider.claimUrl || 'https://club.dolifetoday.com/?publicExchange=true') + '">Claim This Listing</a>',
      '  </div>',
      '</article>'
    ].join('');
  }

  function showError() {
    setVisible(loadingNode, false);
    setVisible(contentNode, false);
    setVisible(errorNode, true);
  }

  const slug = extractSlug();
  if (!slug) {
    showError();
    return;
  }

  fetch(API_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('Unable to load providers');
      return response.json();
    })
    .then(function (payload) {
      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      const matches = providers.filter(function (provider) {
        const values = [provider.locationLabel, provider.location].concat(provider.searchableLocations || []);
        return values.some(function (value) {
          return slugify(value) === slug;
        });
      });

      const locationLabel = matches[0] ? (matches[0].locationLabel || matches[0].location) : slug.replace(/-/g, ' ');
      document.title = locationLabel + ' | The Exchange | Doing Life Today';
      const descriptionMeta = document.querySelector('meta[name="description"]');
      if (descriptionMeta) {
        descriptionMeta.setAttribute('content', 'Browse Parkinson\'s providers and programs in ' + locationLabel + ' on The Exchange by Doing Life Today.');
      }
      updateCanonical('https://dolifetoday.com/exchange/location/' + encodeURIComponent(slug));

      const headingNode = document.getElementById('exchange-location-heading');
      const subtitleNode = document.getElementById('exchange-location-subtitle');
      const breadcrumbNode = document.getElementById('exchange-location-breadcrumb-current');
      const countNode = document.getElementById('exchange-location-count');
      const resultsNode = document.getElementById('exchange-location-results');
      const resultsCard = document.getElementById('exchange-location-results-card');
      const emptyNode = document.getElementById('exchange-location-empty');

      if (headingNode) headingNode.textContent = 'Parkinson\'s providers in ' + locationLabel;
      if (subtitleNode) subtitleNode.textContent = 'Searchable public Exchange listings currently tied to ' + locationLabel + '.';
      if (breadcrumbNode) breadcrumbNode.textContent = locationLabel;
      if (countNode) countNode.textContent = matches.length === 1 ? '1 listing' : matches.length + ' listings';

      setVisible(loadingNode, false);
      setVisible(errorNode, false);
      setVisible(contentNode, true);

      if (!matches.length) {
        setVisible(resultsCard, false);
        setVisible(emptyNode, true);
        return;
      }

      if (resultsNode) {
        resultsNode.innerHTML = matches.map(renderCard).join('');
      }
      setVisible(resultsCard, true);
      setVisible(emptyNode, false);
    })
    .catch(showError);
})();