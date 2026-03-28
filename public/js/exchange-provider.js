(function () {
  'use strict';

  const API_BASE = 'https://club.dolifetoday.com/api/exchange/providers';
  const loadingNode = document.getElementById('exchange-provider-loading');
  const errorNode = document.getElementById('exchange-provider-error');
  const contentNode = document.getElementById('exchange-provider-content');
  const detailShellNode = document.getElementById('exchange-provider-shell');

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
    node.style.display = visible ? '' : 'none';
  }

  function normalizeToArray(value) {
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }

    if (typeof value === 'string') {
      return value ? [value] : [];
    }

    return [];
  }

  function isVisibleSpecialty(value) {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    return normalized && normalized.indexOf('carefund') === -1 && normalized.indexOf('pdiq') === -1;
  }

  function getVisibleSpecialties(value) {
    return normalizeToArray(value).filter(isVisibleSpecialty);
  }

  function showLoading() {
    setVisible(loadingNode, true);
    setVisible(errorNode, false);
    setVisible(contentNode, false);
    setVisible(detailShellNode, false);
  }

  function showReady() {
    setVisible(loadingNode, false);
    setVisible(errorNode, false);
    setVisible(contentNode, true);
    setVisible(detailShellNode, true);
  }

  function ensureRobotsMeta() {
    let robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement('meta');
      robotsMeta.setAttribute('name', 'robots');
      document.head.appendChild(robotsMeta);
    }

    return robotsMeta;
  }

  function showMissingProviderState() {
    document.title = 'Provider not found | The Exchange | Doing Life Today';

    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', 'That Exchange provider listing is no longer available in the public directory. Browse active Parkinson\'s providers in The Exchange instead.');
    }

    const breadcrumbCurrent = document.getElementById('exchange-provider-breadcrumb-current');
    if (breadcrumbCurrent) {
      breadcrumbCurrent.textContent = 'Provider not found';
    }

    updateCanonical('https://dolifetoday.com/exchange');
    ensureRobotsMeta().setAttribute('content', 'noindex, nofollow');
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function buildTagMarkup(values) {
    return (values || [])
      .filter(Boolean)
      .map((value) => '<span class="exchange-tag">' + escapeHtml(value) + '</span>')
      .join('');
  }

  function buildDetailItem(label, valueMarkup) {
    return '<span class="exchange-detail-label">' + escapeHtml(label) + '</span><span class="exchange-detail-value">' + valueMarkup + '</span>';
  }

  function fillList(node, items) {
    if (!node) return;
    node.innerHTML = (items || [])
      .filter(Boolean)
      .map((item) => '<li>' + item + '</li>')
      .join('');
  }

  function updateCanonical(url) {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) {
      link.setAttribute('href', url);
    }
  }

  function renderProvider(provider) {
    const formats = normalizeToArray(provider.formats || provider.format);
    const languages = normalizeToArray(provider.languages);
    const specialties = getVisibleSpecialties(provider.specialties);
    const reviewCount = Number(provider.reviewCount) || 0;
    const rating = Number(provider.rating) || 0;
    const pageTitle = provider.name + ' | The Exchange | Doing Life Today';
    const metaDescription = provider.excerpt || provider.description || ('Explore ' + provider.name + ' in The Exchange, a Parkinson\'s directory connected to The Club for insights, discussions, and reviews.');

    document.title = pageTitle;
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', metaDescription);
    }
    updateCanonical('https://dolifetoday.com' + (provider.detailPagePath || window.location.pathname));
    ensureRobotsMeta().setAttribute('content', 'index, follow');

    const breadcrumbCurrent = document.getElementById('exchange-provider-breadcrumb-current');
    const titleNode = document.getElementById('exchange-provider-title');
    const subtitleNode = document.getElementById('exchange-provider-subtitle');
    const ratingNode = document.getElementById('exchange-provider-rating');
    const markNode = document.getElementById('exchange-provider-mark');
    const badgesNode = document.getElementById('exchange-provider-badges');
    const descriptionNode = document.getElementById('exchange-provider-description');
    const specialtiesNode = document.getElementById('exchange-provider-specialties');
    const formatsNode = document.getElementById('exchange-provider-formats');
    const contactListNode = document.getElementById('exchange-provider-contact-list');
    const detailsListNode = document.getElementById('exchange-provider-details-list');
    const discoveryLinksNode = document.getElementById('exchange-provider-discovery-links');
    const claimLink = document.getElementById('exchange-provider-claim-link');
    const sidebarClaimLink = document.getElementById('exchange-provider-sidebar-claim');
    const clubLink = document.getElementById('exchange-provider-club-link');
    const sidebarClubLink = document.getElementById('exchange-provider-sidebar-club');
    const websiteLink = document.getElementById('exchange-provider-website-link');
    const overviewCard = document.getElementById('exchange-provider-overview-card');
    const specialtiesCard = document.getElementById('exchange-provider-specialties-card');
    const formatsCard = document.getElementById('exchange-provider-formats-card');
    const contactCard = document.getElementById('exchange-provider-contact-card');
    const detailsCard = document.getElementById('exchange-provider-details-card');
    const discoveryCard = document.getElementById('exchange-provider-discovery-card');

    if (breadcrumbCurrent) breadcrumbCurrent.textContent = provider.name;
    if (titleNode) titleNode.textContent = provider.name;
    if (subtitleNode) subtitleNode.textContent = [provider.shortTypeLabel || provider.typeLabel, provider.locationLabel || provider.location].filter(Boolean).join(' · ');
    if (ratingNode) {
      ratingNode.textContent = reviewCount > 0
        ? rating.toFixed(1) + ' rating from ' + reviewCount + ' community reviews'
        : 'Part of The Exchange directory';
    }

    if (markNode) {
      if (provider.logo) {
        markNode.innerHTML = '<img src="' + escapeHtml(provider.logo) + '" alt="' + escapeHtml(provider.name) + ' logo">';
      } else {
        markNode.textContent = (provider.name || '?').charAt(0).toUpperCase();
      }
    }

    if (badgesNode) {
      const badges = (provider.publicBadges || []).slice();
      if (provider.typeLabel && badges.indexOf(provider.typeLabel) === -1) {
        badges.unshift(provider.typeLabel);
      }
      badgesNode.innerHTML = badges.map((badge) => '<span class="exchange-badge">' + escapeHtml(badge) + '</span>').join('');
    }

    if (descriptionNode) descriptionNode.textContent = provider.description || provider.excerpt || '';
    if (specialtiesNode) specialtiesNode.innerHTML = buildTagMarkup(specialties);

    fillList(formatsNode, formats.map(function (format) {
      return escapeHtml(String(format).replace(/-/g, ' '));
    }));

    const contacts = [];
    if (provider.website) {
      contacts.push('<strong>Website</strong><a href="' + escapeHtml(provider.website) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(provider.website) + '</a>');
    }
    if (provider.email) {
      contacts.push('<strong>Email</strong><a href="mailto:' + escapeHtml(provider.email) + '">' + escapeHtml(provider.email) + '</a>');
    }
    if (provider.phone) {
      contacts.push('<strong>Phone</strong><a href="tel:' + escapeHtml(provider.phone) + '">' + escapeHtml(provider.phone) + '</a>');
    }
    fillList(contactListNode, contacts);

    const details = [];
    const discoveryLinks = [];
    if (provider.locationLabel || provider.location) {
      const locationLabel = provider.locationLabel || provider.location;
      const locationHref = '/exchange/location/' + slugify(locationLabel);
      details.push(buildDetailItem('Location', '<a href="' + escapeHtml(locationHref) + '">' + escapeHtml(locationLabel) + '</a>'));
      discoveryLinks.push('<a class="exchange-discovery-link" href="' + escapeHtml(locationHref) + '">More providers in ' + escapeHtml(locationLabel) + '</a>');
    }
    if (languages.length) {
      details.push(buildDetailItem('Languages', escapeHtml(languages.join(', '))));
    }
    if (provider.typeLabel) {
      const categoryHref = '/exchange/category/' + slugify(provider.typeLabel);
      details.push(buildDetailItem('Category', '<a href="' + escapeHtml(categoryHref) + '">' + escapeHtml(provider.typeLabel) + '</a>'));
      discoveryLinks.push('<a class="exchange-discovery-link" href="' + escapeHtml(categoryHref) + '">More ' + escapeHtml(provider.typeLabel) + ' listings</a>');
    }
    specialties.slice(0, 3).forEach(function (specialty) {
      const specialtyHref = '/exchange/category/' + slugify(specialty);
      discoveryLinks.push('<a class="exchange-discovery-link" href="' + escapeHtml(specialtyHref) + '">' + escapeHtml(specialty) + '</a>');
    });
    if (provider.listingStatus) {
      details.push(buildDetailItem('Listing status', escapeHtml(String(provider.listingStatus).replace(/_/g, ' '))));
    }
    fillList(detailsListNode, details);
    if (discoveryLinksNode) {
      discoveryLinksNode.innerHTML = discoveryLinks.join('');
    }

    if (claimLink) claimLink.href = provider.claimAppUrl || provider.claimUrl || 'https://club.dolifetoday.com/?publicExchange=true';
    if (sidebarClaimLink) sidebarClaimLink.href = provider.claimAppUrl || provider.claimUrl || 'https://club.dolifetoday.com/?publicExchange=true';
    if (clubLink) clubLink.href = provider.detailAppUrl || provider.joinClubUrl || 'https://club.dolifetoday.com/?publicExchange=true';
    if (sidebarClubLink) sidebarClubLink.href = provider.detailAppUrl || provider.joinClubUrl || 'https://club.dolifetoday.com/?publicExchange=true';

    if (websiteLink) {
      if (provider.website) {
        websiteLink.href = provider.website;
        setVisible(websiteLink, true);
      } else {
        setVisible(websiteLink, false);
      }
    }

    setVisible(overviewCard, Boolean(provider.description || provider.excerpt));
    setVisible(specialtiesCard, Boolean(specialties.length));
    setVisible(formatsCard, Boolean(formats.length));
    setVisible(contactCard, Boolean(contacts.length));
    setVisible(detailsCard, Boolean(details.length));
    setVisible(discoveryCard, Boolean(discoveryLinks.length));
  }

  function showError() {
    setVisible(loadingNode, false);
    setVisible(contentNode, false);
    setVisible(errorNode, true);
    setVisible(detailShellNode, false);
    showMissingProviderState();
  }

  showLoading();

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
      showReady();

      // Display unclaimed badge if provider is not claimed
      if (!provider.claimedBy && !provider.verified) {
        var unclaimedBadge = document.getElementById('exchange-provider-unclaimed-badge');
        if (unclaimedBadge) unclaimedBadge.hidden = false;

        var ownershipTrigger = document.getElementById('exchange-provider-ownership-trigger');
        if (ownershipTrigger) ownershipTrigger.hidden = false;
      }

      // Display Club metrics from provider data
      var disc = Number(provider.discussion_count || (provider.clubData || {}).discussion_count || 0);
      var revs = Number(provider.review_count || (provider.clubData || {}).review_count || 0);
      var clubViews = Number(provider.club_views || (provider.clubData || {}).club_views || 0);

      if (disc > 0 || revs > 0 || clubViews > 0) {
        var statsEl = document.getElementById('exchange-provider-club-stats');
        var activityLine = document.getElementById('ep-club-activity-line');
        if (statsEl) {
          document.getElementById('ep-club-discussions').textContent = String(disc);
          document.getElementById('ep-club-reviews').textContent = String(revs);
          document.getElementById('ep-club-views').textContent = String(clubViews);
          statsEl.hidden = false;
        }
        if (activityLine) activityLine.hidden = false;
      }
    })
    .catch(showError);
})();