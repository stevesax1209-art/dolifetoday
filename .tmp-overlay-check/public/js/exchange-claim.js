(function () {
  'use strict';

  const API_BASE = 'https://club.dolifetoday.com/api/exchange/providers';
  const loadingNode = document.getElementById('exchange-claim-loading');
  const errorNode = document.getElementById('exchange-claim-error');
  const contentNode = document.getElementById('exchange-claim-content');

  if (!loadingNode || !errorNode || !contentNode) {
    return;
  }

  function extractSlugFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const providerIndex = parts.indexOf('provider');
    if (providerIndex === -1 || !parts[providerIndex + 1]) {
      return '';
    }

    return decodeURIComponent(parts[providerIndex + 1]);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
  }

  function updateCanonical(url) {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) {
      link.setAttribute('href', url);
    }
  }

  function renderProvider(provider) {
    document.title = 'Claim ' + provider.name + ' | The Exchange | Doing Life Today';
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', 'Claim the listing for ' + provider.name + ' inside The Club and continue the verification process there.');
    }
    updateCanonical('https://dolifetoday.com' + (provider.claimPagePath || window.location.pathname));

    const breadcrumbCurrent = document.getElementById('exchange-claim-breadcrumb-current');
    const titleNode = document.getElementById('exchange-claim-title');
    const subtitleNode = document.getElementById('exchange-claim-subtitle');
    const providerNameNode = document.getElementById('exchange-claim-provider-name');
    const providerMetaNode = document.getElementById('exchange-claim-provider-meta');
    const providerBadgesNode = document.getElementById('exchange-claim-provider-badges');
    const providerDescriptionNode = document.getElementById('exchange-claim-provider-description');
    const providerMarkNode = document.getElementById('exchange-claim-provider-mark');
    const providerCardNode = document.getElementById('exchange-claim-provider-card');
    const claimLinkNode = document.getElementById('exchange-claim-club-link');
    const detailLinkNode = document.getElementById('exchange-claim-detail-link');

    if (breadcrumbCurrent) breadcrumbCurrent.textContent = provider.name;
    if (titleNode) titleNode.textContent = 'Claim ' + provider.name;
    if (subtitleNode) subtitleNode.textContent = [provider.shortTypeLabel || provider.typeLabel, provider.locationLabel || provider.location].filter(Boolean).join(' · ');
    if (providerNameNode) providerNameNode.textContent = provider.name;
    if (providerMetaNode) {
      providerMetaNode.textContent = provider.reviewCount > 0
        ? provider.rating.toFixed(1) + ' rating from ' + provider.reviewCount + ' reviews'
        : 'Part of The Exchange directory';
    }
    if (providerDescriptionNode) providerDescriptionNode.textContent = provider.excerpt || provider.description || '';
    if (claimLinkNode) claimLinkNode.href = provider.claimAppUrl || provider.claimUrl || 'https://club.dolifetoday.com/?publicExchange=true';
    if (detailLinkNode) detailLinkNode.href = provider.detailPagePath || '/exchange';

    if (providerMarkNode) {
      if (provider.logo) {
        providerMarkNode.innerHTML = '<img src="' + escapeHtml(provider.logo) + '" alt="' + escapeHtml(provider.name) + ' logo">';
      } else {
        providerMarkNode.textContent = (provider.name || '?').charAt(0).toUpperCase();
      }
    }

    if (providerBadgesNode) {
      const badges = (provider.publicBadges || []).slice();
      if (provider.typeLabel && badges.indexOf(provider.typeLabel) === -1) {
        badges.unshift(provider.typeLabel);
      }
      providerBadgesNode.innerHTML = badges.map(function (badge) {
        return '<span class="exchange-badge">' + escapeHtml(badge) + '</span>';
      }).join('');
    }

    setVisible(providerCardNode, true);
  }

  function showError() {
    setVisible(loadingNode, false);
    setVisible(contentNode, false);
    setVisible(errorNode, true);
  }

  const slug = extractSlugFromPath();
  if (!slug) {
    showError();
    return;
  }

  fetch(API_BASE + '?slug=' + encodeURIComponent(slug) + '&limit=1', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Unable to load provider');
      }
      return response.json();
    })
    .then(function (payload) {
      const provider = Array.isArray(payload.providers) ? payload.providers[0] : null;
      if (!provider) {
        showError();
        return;
      }

      renderProvider(provider);
      setVisible(loadingNode, false);
      setVisible(errorNode, false);
      setVisible(contentNode, true);
    })
    .catch(showError);
})();