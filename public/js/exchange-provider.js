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

    // Only override canonical + inject `noindex` when we're serving the empty
    // fallback template (Firebase rewrite `/exchange/provider/**` →
    // `/exchange-provider.html`, canonical = "/exchange"). Prerendered static
    // provider pages already contain valid indexable content (specific title,
    // description, self-referencing canonical, and LocalBusiness JSON-LD), so
    // a transient JS fetch failure should NOT flip them to noindex — that
    // costs long-tail SEO on real, claimable listings (5,154 pages flagged
    // by Google Search Console 2026-06-30 exactly because of this).
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    const canonicalHref = canonicalLink ? canonicalLink.getAttribute('href') || '' : '';
    const isPrerenderedPage = canonicalHref.indexOf('/exchange/provider/') !== -1;

    if (!isPrerenderedPage) {
      updateCanonical('https://dolifetoday.com/exchange');
      ensureRobotsMeta().setAttribute('content', 'noindex, nofollow');
    }
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
    const metaDescription = provider.excerpt || provider.description || ('Explore ' + provider.name + ' on The Exchange — the Parkinson\'s provider directory by Doing Life Today.');

    document.title = pageTitle;
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', metaDescription);
    }
    updateCanonical('https://dolifetoday.com' + (provider.detailPagePath || window.location.pathname));
    ensureRobotsMeta().setAttribute('content', 'index, follow');

    // Update JSON-LD structured data for SEO
    var jsonLd = document.getElementById('provider-jsonld');
    if (jsonLd) {
      var schema = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        'name': provider.name,
        'description': metaDescription,
        'url': 'https://dolifetoday.com' + (provider.detailPagePath || window.location.pathname)
      };
      if (provider.website) schema.sameAs = provider.website;
      if (provider.phone) schema.telephone = provider.phone;
      if (provider.email) schema.email = provider.email;
      if (provider.city || provider.state) {
        schema.address = {
          '@type': 'PostalAddress',
          'addressLocality': provider.city || '',
          'addressRegion': provider.state || '',
          'addressCountry': 'US'
        };
      }
      if (reviewCount > 0 && rating > 0) {
        schema.aggregateRating = {
          '@type': 'AggregateRating',
          'ratingValue': rating.toFixed(1),
          'reviewCount': reviewCount
        };
      }
      if (provider.logo) schema.image = provider.logo;
      jsonLd.textContent = JSON.stringify(schema);
    }

    // Update OG tags for social sharing
    var ogTitle = document.querySelector('meta[property="og:title"]');
    var ogDesc = document.querySelector('meta[property="og:description"]');
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogTitle) ogTitle.setAttribute('content', pageTitle);
    if (ogDesc) ogDesc.setAttribute('content', metaDescription);
    if (ogUrl) ogUrl.setAttribute('content', 'https://dolifetoday.com' + (provider.detailPagePath || window.location.pathname));

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
        ? rating.toFixed(1) + ' rating \u00b7 ' + reviewCount + ' community reviews'
        : 'Listed on The Exchange';
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
      badgesNode.innerHTML = badges.map(function (badge) {
        var cls = 'exchange-badge';
        if (badge === 'Verified') cls += ' exchange-badge--verified';
        if (badge === 'Community Provider') cls += ' exchange-badge--partner';
        return '<span class="' + cls + '">' + escapeHtml(badge) + '</span>';
      }).join('');
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

    var claimHref = '/claim-listing?provider=' + encodeURIComponent(provider.id || provider.slug || '');
    if (claimLink) claimLink.href = claimHref;
    if (sidebarClaimLink) sidebarClaimLink.href = claimHref;

    // Hide claim buttons for verified / claimed providers
    if (provider.verified || provider.claimedBy) {
      if (claimLink) setVisible(claimLink, false);
      if (sidebarClaimLink) setVisible(sidebarClaimLink, false);
    }
    if (clubLink) clubLink.href = provider.detailAppUrl || provider.detailPagePath || '/exchange';
    if (sidebarClubLink) sidebarClubLink.href = provider.detailAppUrl || provider.detailPagePath || '/exchange';

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

    /* Product context line + disclaimer */
    var isProduct = (provider.type || provider.category) && String(provider.type || provider.category).indexOf('products') === 0;
    if (isProduct && overviewCard) {
      var disclaimerEl = document.createElement('p');
      disclaimerEl.className = 'exchange-product-disclaimer';
      disclaimerEl.style.cssText = 'font-size:0.82rem;color:var(--color-text-muted,#64748b);margin-top:1rem;line-height:1.6;';
      disclaimerEl.textContent = 'Product listings are provided for discovery and awareness. Always review details and consult with a healthcare professional when appropriate.';
      overviewCard.appendChild(disclaimerEl);
    }

    /* Shipping countries */
    if (isProduct && provider.shippingCountries && provider.shippingCountries.length) {
      var shipsNode = formatsCard || overviewCard;
      if (shipsNode) {
        var shipsEl = document.createElement('p');
        shipsEl.style.cssText = 'margin-top:0.75rem;font-size:0.92rem;color:var(--color-text-muted,#64748b);';
        shipsEl.textContent = 'Ships to: ' + provider.shippingCountries.join(', ');
        shipsNode.appendChild(shipsEl);
      }
    }

    /* Buy link for products */
    if (isProduct && provider.buyLink) {
      var buyContainer = contactCard || overviewCard;
      if (buyContainer) {
        var buyEl = document.createElement('a');
        buyEl.href = provider.buyLink;
        buyEl.target = '_blank';
        buyEl.rel = 'noopener noreferrer';
        buyEl.className = 'btn btn-primary';
        buyEl.style.cssText = 'margin-top:1rem;display:inline-flex;align-items:center;gap:0.5rem;';
        buyEl.textContent = 'View Product';
        buyContainer.appendChild(buyEl);
      }
    }

    /* ── Tier treatments ─────────────────────────────────── */
    var heroContent = document.getElementById('exchange-provider-content');
    var isPartner = provider.listingStatus === 'community_provider' || (provider.publicBadges || []).indexOf('Community Provider') !== -1;
    var isVerified = provider.verified;

    if (isPartner && heroContent) {
      heroContent.classList.add('exchange-tier--partner');
      if (markNode) markNode.classList.add('exchange-provider-mark--partner');
      // Insert partner banner before badges
      var bannerEl = document.createElement('div');
      bannerEl.className = 'exchange-partner-banner';
      bannerEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 0l2.35 4.76L16 5.53l-4 3.9.94 5.51L8 12.27l-4.94 2.67L4 9.43 0 5.53l5.65-.77L8 0z" fill="currentColor"/></svg> Community Partner';
      badgesNode.parentNode.insertBefore(bannerEl, badgesNode);
    } else if (isVerified && heroContent) {
      heroContent.classList.add('exchange-tier--verified');
      if (markNode) markNode.classList.add('exchange-provider-mark--verified');
    }
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