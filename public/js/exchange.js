(function () {
  'use strict';

  const API_ENDPOINT = 'https://club.dolifetoday.com/api/exchange/providers?limit=10000&v=20260327-1';
  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=';
  const GEOCODE_CACHE_KEY = 'exchange-geocode-cache-v1';
  const MAX_DISTANCE_LOCATION_LOOKUPS = 120;

  const searchInput = document.getElementById('exchange-search');
  const postalInput = document.getElementById('exchange-postal');
  const countrySelect = document.getElementById('exchange-country');
  const radiusSelect = document.getElementById('exchange-radius');
  const typeSelect = document.getElementById('exchange-type');
  const formatSelect = document.getElementById('exchange-format');
  const languageSelect = document.getElementById('exchange-language');
  const sortSelect = document.getElementById('exchange-sort');
  const clearFiltersButton = document.getElementById('exchange-clear-filters');
  const statusNode = document.getElementById('exchange-status');
  const statusDetailNode = document.getElementById('exchange-status-detail');
  const distanceNoteNode = document.getElementById('exchange-distance-note');
  const resultsNode = document.getElementById('exchange-results');
  const liveCountNode = document.getElementById('exchange-live-count');
  const countryCountNode = document.getElementById('exchange-country-count');
  const languageCountNode = document.getElementById('exchange-language-count');

  if (!searchInput || !postalInput || !countrySelect || !radiusSelect || !typeSelect || !formatSelect || !languageSelect || !sortSelect || !clearFiltersButton || !statusNode || !statusDetailNode || !distanceNoteNode || !resultsNode) {
    return;
  }

  let allProviders = [];
  let renderTimer = 0;
  let activeRenderToken = 0;
  let geocodePersistTimer = 0;
  const geocodeCache = loadGeocodeCache();

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

    return '/claim-listing';
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

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function compactWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isPostalLikeText(value) {
    const compactValue = compactWhitespace(value).replace(/,/g, '');
    return /\d/.test(compactValue) && /[a-z]/i.test(compactValue) && compactValue.length <= 12;
  }

  function buildGeocodeCandidates(query) {
    const trimmedQuery = compactWhitespace(query);
    const candidates = [];

    function addCandidate(value) {
      const candidate = compactWhitespace(value);
      if (candidate && candidates.indexOf(candidate) === -1) {
        candidates.push(candidate);
      }
    }

    addCandidate(trimmedQuery);

    if (isPostalLikeText(trimmedQuery)) {
      addCandidate(trimmedQuery.replace(/\s+/g, ''));
    }

    const commaIndex = trimmedQuery.indexOf(',');
    if (commaIndex !== -1) {
      const primaryPart = compactWhitespace(trimmedQuery.slice(0, commaIndex));
      const secondaryPart = compactWhitespace(trimmedQuery.slice(commaIndex + 1));

      addCandidate(primaryPart);
      if (isPostalLikeText(primaryPart)) {
        addCandidate(primaryPart.replace(/\s+/g, '') + (secondaryPart ? ', ' + secondaryPart : ''));
        addCandidate(primaryPart.replace(/\s+/g, ''));
      }
    }

    return candidates;
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function (left, right) {
      return String(left).localeCompare(String(right));
    });
  }

  function loadGeocodeCache() {
    try {
      const raw = window.localStorage.getItem(GEOCODE_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function persistGeocodeCache() {
    window.clearTimeout(geocodePersistTimer);
    geocodePersistTimer = window.setTimeout(function () {
      try {
        window.localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeCache));
      } catch (_error) {
        // Ignore localStorage write failures.
      }
    }, 120);
  }

  function getDistanceUnit(country) {
    return country === 'United States' ? 'mi' : 'km';
  }

  function updateRadiusOptions(unit) {
    Array.prototype.forEach.call(radiusSelect.options, function (option) {
      const value = Number(option.value || '0');
      option.textContent = value + ' ' + unit;
    });
  }

  function convertRadiusToKilometers(radiusValue, unit) {
    return unit === 'mi' ? radiusValue * 1.60934 : radiusValue;
  }

  function getDistanceDisplay(distanceKilometers, unit) {
    if (!Number.isFinite(distanceKilometers)) {
      return '';
    }

    if (unit === 'mi') {
      const miles = distanceKilometers * 0.621371;
      return (miles < 10 ? miles.toFixed(1) : Math.round(miles)) + ' mi';
    }

    return (distanceKilometers < 10 ? distanceKilometers.toFixed(1) : Math.round(distanceKilometers)) + ' km';
  }

  function calculateDistanceKilometers(origin, target) {
    const earthRadiusKm = 6371;
    const latDistance = toRadians(target.latitude - origin.latitude);
    const lonDistance = toRadians(target.longitude - origin.longitude);
    const a = Math.sin(latDistance / 2) * Math.sin(latDistance / 2)
      + Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(target.latitude))
      * Math.sin(lonDistance / 2) * Math.sin(lonDistance / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  function toRadians(value) {
    return value * (Math.PI / 180);
  }

  function buildLocationQuery(provider) {
    const parts = [provider.city, provider.stateProvince, provider.country].filter(Boolean);
    if (parts.length) {
      return parts.join(', ');
    }
    return provider.locationLabel || provider.location || '';
  }

  function isVirtualOnly(provider) {
    const formats = (provider.formats || provider.format || []).map(function (value) {
      return normalizeText(value);
    });
    return formats.indexOf('virtual') !== -1 && formats.indexOf('in-person') === -1 && formats.indexOf('hybrid') === -1;
  }

  function buildQueryScore(provider) {
    var score = 0;
    if (provider.verified) {
      score += 18;
    }
    if (provider.listingStatus === 'community_provider') {
      score += 12;
    }
    score += Number(provider.reviewCount || 0) * 2;
    score += Number(provider.rating || 0);
    // Include trending factors
    if (provider.boostScore) {
      score += Number(provider.boostScore);
    }
    return score;
  }

  function buildTrendingScore(provider) {
    var views = Number(provider.views || provider.viewCount || 0);
    var disc = Number(provider.discussion_count || (provider.clubData || {}).discussion_count || 0);
    var revs = Number(provider.review_count || (provider.clubData || {}).review_count || 0);
    var boost = Number(provider.boostScore || 0);
    return (views * 1) + (disc * 5) + (revs * 5) + boost;
  }

  function renderTrendingBanner(providers) {
    var trendingBanner = document.getElementById('exchange-trending-banner');
    var trendingCards = document.getElementById('exchange-trending-cards');
    if (!trendingBanner || !trendingCards) return;

    var scored = providers.map(function (p) {
      return { provider: p, score: buildTrendingScore(p) };
    }).filter(function (item) {
      return item.score > 0;
    }).sort(function (a, b) {
      return b.score - a.score;
    }).slice(0, 3);

    if (scored.length === 0) {
      trendingBanner.hidden = true;
      return;
    }

    trendingBanner.hidden = false;
    trendingCards.innerHTML = scored.map(function (item, idx) {
      var p = item.provider;
      var detailUrl = buildProviderDetailUrl(p);
      var initial = escapeHtml((p.name || '?').charAt(0).toUpperCase());
      var mark = p.logo
        ? '<img src="' + escapeHtml(p.logo) + '" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
        : '<span class="exchange-trending-initial">' + initial + '</span>';
      var claimed = p.claimedBy || p.verified;
      var unclaimedNote = !claimed
        ? '<span class="exchange-trending-unclaimed">\u26a1 This listing is gaining attention</span>'
        + '<span class="exchange-trending-momentum">Don\'t miss this momentum</span>'
        + '<a href="/claim-listing" class="exchange-trending-claim-link" onclick="if(window.ProviderTrack){ProviderTrack.track(\'claim_listing_clicked\',{source:\'trending_card\'})}">\ud83d\udc49 Claim &amp; grow your presence</a>'
        : '';

      return '<a href="' + escapeHtml(detailUrl) + '" class="exchange-trending-card">'
        + '<div class="exchange-trending-rank">\ud83d\udd25 Trending #' + (idx + 1) + '</div>'
        + '<div class="exchange-trending-info">'
        + mark
        + '<span class="exchange-trending-name">' + escapeHtml(p.name) + '</span>'
        + '</div>'
        + unclaimedNote
        + '</a>';
    }).join('');
  }

  function compareProvidersByDistance(left, right) {
    const leftHasDistance = Number.isFinite(left.distanceKilometers);
    const rightHasDistance = Number.isFinite(right.distanceKilometers);
    const leftVirtual = isVirtualOnly(left);
    const rightVirtual = isVirtualOnly(right);

    if (leftHasDistance && rightHasDistance) {
      if (left.distanceKilometers !== right.distanceKilometers) {
        return left.distanceKilometers - right.distanceKilometers;
      }
      return left.name.localeCompare(right.name);
    }

    if (leftHasDistance) {
      return -1;
    }

    if (rightHasDistance) {
      return 1;
    }

    if (leftVirtual && !rightVirtual) {
      return -1;
    }

    if (!leftVirtual && rightVirtual) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  }

  function sortProviders(providers, sortBy, postalSearchActive) {
    return providers.slice().sort(function (left, right) {
      if (sortBy === 'distance' || postalSearchActive) {
        const distanceComparison = compareProvidersByDistance(left, right);
        if (distanceComparison !== 0) {
          return distanceComparison;
        }
      }

      if (sortBy === 'rating') {
        if (right.rating !== left.rating) {
          return right.rating - left.rating;
        }
        if (right.reviewCount !== left.reviewCount) {
          return right.reviewCount - left.reviewCount;
        }
      }

      if (sortBy === 'name') {
        return left.name.localeCompare(right.name);
      }

      const scoreDelta = buildQueryScore(right) - buildQueryScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.name.localeCompare(right.name);
    });
  }

  function getBaseFilteredProviders() {
    const searchTerm = normalizeText(searchInput.value);
    const country = countrySelect.value;
    const type = typeSelect.value;
    const format = formatSelect.value;
    const language = languageSelect.value;

    return allProviders.filter(function (provider) {
      if (country !== 'all' && provider.country !== country) {
        return false;
      }

      if (type !== 'all' && provider.typeLabel !== type) {
        return false;
      }

      if (format !== 'all' && !(provider.formats || provider.format || []).some(function (value) {
        return normalizeText(value) === format;
      })) {
        return false;
      }

      if (language !== 'all' && !(provider.languages || []).some(function (value) {
        return normalizeText(value) === normalizeText(language);
      })) {
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
        (provider.languages || []).join(' ')
      ].join(' ').toLowerCase();

      return haystack.indexOf(searchTerm) !== -1;
    });
  }

  function setStatus(primary, detail) {
    statusNode.textContent = primary || '';
    statusDetailNode.textContent = detail || '';
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function updateDirectoryStats(providers, countries, languages) {
    if (liveCountNode) {
      liveCountNode.textContent = formatCount(providers.length);
    }

    if (countryCountNode) {
      countryCountNode.textContent = formatCount(countries.length);
    }

    if (languageCountNode) {
      languageCountNode.textContent = formatCount(languages.length);
    }
  }

  function updateFilterState() {
    const hasActiveFilters = Boolean(
      searchInput.value.trim()
      || postalInput.value.trim()
      || countrySelect.value !== 'all'
      || radiusSelect.value !== '50'
      || typeSelect.value !== 'all'
      || formatSelect.value !== 'all'
      || languageSelect.value !== 'all'
      || sortSelect.value !== 'relevance'
    );

    clearFiltersButton.hidden = !hasActiveFilters;
    distanceNoteNode.textContent = postalInput.value.trim()
      ? 'Distance search ranks nearby in-person and hybrid providers first, while still keeping matching virtual listings in the results.'
      : 'Add a ZIP or postal code to rank nearby results and keep matching virtual listings in view.';
  }

  function normalizeGeocodeResult(item) {
    if (!item || !item.lat || !item.lon) {
      return null;
    }

    return {
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      label: item.display_name || '',
      address: {
        country: item.address && item.address.country ? item.address.country : '',
        stateProvince: item.address && (item.address.state || item.address.region || item.address.county) ? (item.address.state || item.address.region || item.address.county) : ''
      }
    };
  }

  function geocodeQuery(query) {
    const trimmedQuery = String(query || '').trim();
    const cacheKey = normalizeText(trimmedQuery);
    const candidates = buildGeocodeCandidates(trimmedQuery);

    if (!trimmedQuery) {
      return Promise.resolve(null);
    }

    if (Object.prototype.hasOwnProperty.call(geocodeCache, cacheKey)) {
      return Promise.resolve(geocodeCache[cacheKey]);
    }

    return candidates.reduce(function (promise, candidate) {
      return promise.then(function (result) {
        if (result) {
          return result;
        }

        return fetch(GEOCODE_ENDPOINT + encodeURIComponent(candidate), {
          headers: {
            Accept: 'application/json'
          },
          cache: 'force-cache'
        })
          .then(function (response) {
            if (!response.ok) {
              return null;
            }
            return response.json();
          })
          .then(function (payload) {
            return Array.isArray(payload) && payload.length ? normalizeGeocodeResult(payload[0]) : null;
          })
          .catch(function () {
            return null;
          });
      });
    }, Promise.resolve(null)).then(function (result) {
      candidates.forEach(function (candidate) {
        geocodeCache[normalizeText(candidate)] = result;
      });
      geocodeCache[cacheKey] = result;
      persistGeocodeCache();
      return result;
    });
  }

  function geocodeProviderLocations(queries, renderToken) {
    const results = new Map();
    let sequence = Promise.resolve();

    queries.forEach(function (query) {
      sequence = sequence.then(function () {
        if (renderToken !== activeRenderToken) {
          return null;
        }
        return geocodeQuery(query).then(function (location) {
          results.set(query, location);
          return null;
        });
      });
    });

    return sequence.then(function () {
      return results;
    });
  }

  function buildOriginQuery(postalCode, country) {
    return [postalCode, country !== 'all' ? country : ''].filter(Boolean).join(', ');
  }

  function buildDistanceSortedProviders(baseProviders, postalCode, renderToken) {
    const explicitCountry = countrySelect.value;
    const originQuery = buildOriginQuery(postalCode, explicitCountry);

    return geocodeQuery(originQuery).then(function (origin) {
      if (renderToken !== activeRenderToken) {
        return null;
      }

      if (!origin) {
        return {
          origin: null,
          providers: [],
          physicalWithinRadius: 0,
          virtualCount: 0,
          unresolvedCount: 0,
          overflowCount: 0,
          unit: getDistanceUnit(explicitCountry),
          radiusValue: Number(radiusSelect.value || '50')
        };
      }

      const unit = getDistanceUnit(origin.address.country || explicitCountry);
      updateRadiusOptions(unit);

      const radiusValue = Number(radiusSelect.value || '50');
      const radiusKilometers = convertRadiusToKilometers(radiusValue, unit);
      const virtualProviders = baseProviders.filter(isVirtualOnly);
      const inPersonCandidates = baseProviders.filter(function (provider) {
        if (isVirtualOnly(provider)) {
          return false;
        }
        if (explicitCountry !== 'all') {
          return provider.country === explicitCountry;
        }
        return provider.country === origin.address.country;
      });

      const locationQueries = uniqueSorted(inPersonCandidates.map(buildLocationQuery));
      const limitedQueries = locationQueries.slice(0, MAX_DISTANCE_LOCATION_LOOKUPS);
      const overflowCount = Math.max(locationQueries.length - limitedQueries.length, 0);

      return geocodeProviderLocations(limitedQueries, renderToken).then(function (locationMap) {
        if (renderToken !== activeRenderToken) {
          return null;
        }

        const providersWithDistance = inPersonCandidates.map(function (provider) {
          const location = locationMap.get(buildLocationQuery(provider));
          if (!location) {
            return provider;
          }

          return Object.assign({}, provider, {
            distanceKilometers: calculateDistanceKilometers(origin, location)
          });
        });

        const nearbyProviders = providersWithDistance.filter(function (provider) {
          return Number.isFinite(provider.distanceKilometers) && provider.distanceKilometers <= radiusKilometers;
        });

        const unresolvedCount = providersWithDistance.filter(function (provider) {
          return !Number.isFinite(provider.distanceKilometers);
        }).length;

        return {
          origin: origin,
          providers: nearbyProviders.concat(virtualProviders),
          physicalWithinRadius: nearbyProviders.length,
          virtualCount: virtualProviders.length,
          unresolvedCount: unresolvedCount,
          overflowCount: overflowCount,
          unit: unit,
          radiusValue: radiusValue
        };
      });
    });
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

  function renderCards(filteredProviders, distanceUnit) {
    resultsNode.innerHTML = filteredProviders.map(function (provider) {
      const initial = escapeHtml((provider.name || '?').charAt(0).toUpperCase());
      const detailUrl = buildProviderDetailUrl(provider);
      const claimUrl = buildProviderClaimUrl(provider);
      const mark = provider.logo
        ? '<div class="exchange-card-mark"><img src="' + escapeHtml(provider.logo) + '" alt="' + escapeHtml(provider.name) + ' logo"></div>'
        : '<div class="exchange-card-mark">' + initial + '</div>';

      const ratingLabel = provider.reviewCount > 0
        ? provider.rating.toFixed(1) + ' rating from ' + provider.reviewCount + ' reviews'
        : 'Community listing';

      const ratingPill = provider.reviewCount > 0
        ? '<span class="exchange-card-rating-pill">' + escapeHtml(provider.rating.toFixed(1) + ' stars') + '</span>'
        : '<span class="exchange-card-rating-pill exchange-card-rating-pill-muted">New listing</span>';

      const submeta = [
        provider.typeLabel,
        provider.locationLabel || provider.location,
        Number.isFinite(provider.distanceKilometers) ? '<span class="exchange-card-distance">' + escapeHtml(getDistanceDisplay(provider.distanceKilometers, distanceUnit)) + ' away</span>' : ''
      ].filter(Boolean).join('<span aria-hidden="true">|</span>');

      const badges = ((provider.publicBadges || []).length ? provider.publicBadges : [provider.typeLabel, provider.location])
        .concat((provider.formats || []).slice(0, 2).map((format) => format.replace('-', ' ')))
        .map((badge) => '<span class="exchange-badge">' + escapeHtml(badge) + '</span>')
        .join('');

      const tags = getVisibleSpecialties(provider).slice(0, 4)
        .map((tag) => '<span class="exchange-tag">' + escapeHtml(tag) + '</span>')
        .join('');

      const detailButton = '<a class="btn btn-primary" href="' + escapeHtml(detailUrl) + '">View Details</a>';
      const clubButton = '<a class="btn btn-outline-primary" href="' + escapeHtml(provider.detailAppUrl || provider.joinClubUrl) + '">View in The Club</a>';

      const verifiedBadge = provider.verified
        ? '<span class="exchange-card-kicker">Verified provider</span>'
        : '';

      const typeKicker = provider.shortTypeLabel || provider.typeLabel || 'Provider';

      return [
        '<article class="card exchange-card">',
        '  <div class="exchange-card-header-row">',
             verifiedBadge || ('<span class="exchange-card-kicker">' + escapeHtml(typeKicker) + '</span>'),
             ratingPill,
        '  </div>',
        '  <div class="exchange-card-top">',
             mark,
        '    <div class="exchange-card-heading">',
           '      <h3><a class="exchange-card-link" href="' + escapeHtml(detailUrl) + '">' + escapeHtml(provider.name) + '</a></h3>',
        '      <p class="exchange-card-meta">' + escapeHtml(ratingLabel) + '</p>',
          submeta ? '      <p class="exchange-card-submeta">' + submeta + '</p>' : '',
        '    </div>',
        '  </div>',
        '  <div class="exchange-card-badges">' + badges + '</div>',
        '  <p class="exchange-card-copy">' + escapeHtml(provider.excerpt) + '</p>',
        tags ? '  <div class="exchange-card-tags">' + tags + '</div>' : '',
        '  <div class="exchange-card-actions">',
           detailButton,
        '  </div>',
        '  <div class="exchange-card-actions exchange-card-actions-secondary">',
          clubButton,
           '    <a class="btn btn-primary" href="' + escapeHtml(claimUrl) + '">Claim This Listing</a>',
        '  </div>',
        '</article>',
      ].join('');
    }).join('');
  }

  function renderEmptyState(title, message) {
    resultsNode.innerHTML = '<article class="card exchange-empty-state"><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(message) + '</p></article>';
  }

  function renderProviders() {
    const renderToken = ++activeRenderToken;
    const baseProviders = getBaseFilteredProviders();
    const postalCode = postalInput.value.trim();

    updateFilterState();
    updateRadiusOptions(getDistanceUnit(countrySelect.value));

    if (!postalCode) {
      const sortedProviders = sortProviders(baseProviders, sortSelect.value, false);
      setStatus(
        sortedProviders.length === 1 ? '1 provider shown' : sortedProviders.length + ' providers shown',
        'Search Parkinson\'s providers, programs, and services by location, service type, language, or ZIP/postal code, then step into The Club for insights, discussions, and reviews.'
      );

      if (!sortedProviders.length) {
        renderEmptyState('No providers match this filter', 'Try a different provider type, service mode, language, or postal search.');
        return;
      }

      renderCards(sortedProviders, getDistanceUnit(countrySelect.value));
      return;
    }

    setStatus('Finding providers near ' + postalCode + '...', 'Distance search includes matching virtual listings alongside nearby in-person and hybrid options.');

    buildDistanceSortedProviders(baseProviders, postalCode, renderToken)
      .then(function (distanceResult) {
        if (!distanceResult || renderToken !== activeRenderToken) {
          return;
        }

        if (!distanceResult.origin) {
          setStatus('We could not place that ZIP or postal code.', 'Try another code, add a country filter, or clear distance search.');
          renderEmptyState('Distance search could not start', 'We could not place that ZIP or postal code. Try another code, add a country filter, or clear distance search.');
          return;
        }

        const sortedProviders = sortProviders(distanceResult.providers, sortSelect.value, true);
        const detailParts = [
          distanceResult.physicalWithinRadius + ' nearby in-person or hybrid',
          distanceResult.virtualCount + ' virtual match' + (distanceResult.virtualCount === 1 ? '' : 'es')
        ];

        if (distanceResult.unresolvedCount > 0) {
          detailParts.push(distanceResult.unresolvedCount + ' location' + (distanceResult.unresolvedCount === 1 ? '' : 's') + ' could not be distance-ranked');
        }

        if (distanceResult.overflowCount > 0) {
          detailParts.push('refine your filters to rank more locations');
        }

        setStatus(
          sortedProviders.length === 1
            ? '1 provider matched near ' + postalCode
            : sortedProviders.length + ' providers matched near ' + postalCode,
          detailParts.join(' | ') + ' | within ' + distanceResult.radiusValue + ' ' + distanceResult.unit
        );

        if (!sortedProviders.length) {
          renderEmptyState(
            'No providers matched that distance search',
            'Try a larger radius, a different ZIP/postal code, or broader provider filters.'
          );
          return;
        }

        renderCards(sortedProviders, distanceResult.unit);
      })
      .catch(function () {
        if (renderToken !== activeRenderToken) {
          return;
        }

        setStatus('Distance search is temporarily unavailable.', 'You can still search by provider name, location, service mode, or language.');
        renderEmptyState('Distance search is temporarily unavailable', 'Please try again shortly or clear the ZIP/postal field to continue browsing.');
      });
  }

  function queueRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderProviders, 180);
  }

  function bindFilters() {
    [searchInput, postalInput].forEach(function (node) {
      node.addEventListener('input', queueRender);
    });

    [countrySelect, radiusSelect, typeSelect, formatSelect, languageSelect, sortSelect].forEach(function (node) {
      node.addEventListener('change', renderProviders);
    });

    clearFiltersButton.addEventListener('click', function () {
      searchInput.value = '';
      postalInput.value = '';
      countrySelect.value = 'all';
      radiusSelect.value = '50';
      typeSelect.value = 'all';
      formatSelect.value = 'all';
      languageSelect.value = 'all';
      sortSelect.value = 'relevance';
      renderProviders();
    });
  }

  fetch(API_ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Unable to load providers');
      }
      return response.json();
    })
    .then(function (payload) {
      allProviders = Array.isArray(payload.providers) ? payload.providers : [];

      const countries = uniqueSorted(allProviders.map(function (provider) { return provider.country; }));
      const types = uniqueSorted(allProviders.map(function (provider) { return provider.typeLabel; }));
      const languages = uniqueSorted([].concat.apply([], allProviders.map(function (provider) {
        return provider.languages || [];
      })));

      updateDirectoryStats(allProviders, countries, languages);

      buildOptions(countrySelect, countries, 'All countries');
      buildOptions(typeSelect, types, 'All provider types');
      buildOptions(languageSelect, languages, 'All languages');
      updateRadiusOptions('mi');
      bindFilters();
      updateFilterState();
      renderTrendingBanner(allProviders);
      renderProviders();
    })
    .catch(function () {
      setStatus('The Exchange is temporarily unavailable.', 'Please try again shortly or view the directory inside The Club.');
      resultsNode.innerHTML = '<article class="card exchange-empty-state"><h3>Unable to load providers right now</h3><p>Please try again shortly or view the directory inside The Club.</p><p><a class="btn btn-primary" href="https://club.dolifetoday.com/?publicExchange=true">View in The Club</a></p></article>';
    });
})();