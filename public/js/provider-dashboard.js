/* ============================================================
   PROVIDER DASHBOARD — Client-side logic
   Listing management, visibility stats, Club activity, upgrade triggers
   ============================================================ */

(function () {
  'use strict';

  let providerData = null;
  let dashboardMeta = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (!ProviderAuth.requireAuth('/provider-dashboard')) return;
    loadDashboard();
  }

  async function loadDashboard() {
    try {
      const data = await ProviderAuth.apiCall('/provider/dashboard', { method: 'GET' });
      providerData = data.provider;
      dashboardMeta = {
        signals: data.signals || {},
        upgradeScore: data.upgradeScore || 0,
        upgradeLevel: data.upgradeLevel || 'LOW',
        nextStep: data.nextStep || null,
        trendingScore: data.trendingScore || 0,
        isTrending: data.isTrending || false,
      };

      document.getElementById('dash-loading').hidden = true;
      document.getElementById('dash-content').hidden = false;
      ProviderAuth.renderAuthBar(document.getElementById('pe-auth-bar-mount'));

      renderDashboard();
      checkUpgradeSuccess();

      // Track dashboard view
      if (window.ProviderTrack) ProviderTrack.track('dashboard_viewed');
    } catch (err) {
      document.getElementById('dash-loading').innerHTML =
        '<p style="color:#ef4444;">Unable to load dashboard: ' + ProviderAuth.escapeHtml(err.message) + '</p>' +
        '<a href="/claim-listing?auth=signin" class="btn btn-outline-primary" style="margin-top:1rem;">Sign In</a>';
    }
  }

  function renderDashboard() {
    const p = providerData;
    if (!p) return;

    document.getElementById('dash-provider-name').textContent = p.name || 'Your Listing';

    // Status bar
    const statusBar = document.getElementById('dash-status-bar');
    statusBar.innerHTML =
      '<span class="pe-status pe-status-' + (p.status || 'pending').toLowerCase() + '">' + (p.status || 'PENDING') + '</span>' +
      '<span class="pe-tier pe-tier-' + (p.tier || 'free').toLowerCase() + '">' + (p.tier || 'FREE') + ' tier</span>';

    // Status notices
    const noticesSection = document.getElementById('dash-notices');
    if (p.status === 'PENDING') {
      noticesSection.hidden = false;
      document.getElementById('dash-pending-notice').hidden = false;
    } else if (p.status === 'REJECTED') {
      noticesSection.hidden = false;
      document.getElementById('dash-rejected-notice').hidden = false;
      document.getElementById('dash-rejected-reason').textContent = p.rejectionReason || 'Your listing did not meet our requirements.';
    }

    // Populate edit form
    populateEditForm(p);

    // Visibility stats
    document.getElementById('dash-stat-views').textContent = formatNumber(p.views || 0);
    document.getElementById('dash-stat-clicks').textContent = formatNumber(p.clicks || 0);
    document.getElementById('dash-stat-searches').textContent = formatNumber(p.searchAppearances || 0);

    // Club stats
    const clubData = p.clubData || {};
    document.getElementById('dash-club-views').textContent = formatNumber(clubData.club_views || 0);
    document.getElementById('dash-club-discussions').textContent = formatNumber(clubData.discussion_count || 0);
    document.getElementById('dash-club-reviews').textContent = formatNumber(clubData.review_count || 0);

    // Club average rating
    var avgRating = clubData.average_rating || 0;
    var reviewCount = clubData.review_count || 0;
    if (reviewCount > 0 && avgRating > 0) {
      var ratingEl = document.getElementById('dash-club-rating');
      if (ratingEl) {
        var fullStars = Math.floor(avgRating);
        var halfStar = (avgRating - fullStars) >= 0.5 ? 1 : 0;
        var emptyStars = 5 - fullStars - halfStar;
        var starsHtml = '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(emptyStars);
        document.getElementById('dash-club-rating-stars').textContent = starsHtml;
        document.getElementById('dash-club-rating-value').textContent = avgRating.toFixed(1);
        document.getElementById('dash-club-rating-count').textContent = '(' + reviewCount + ' review' + (reviewCount !== 1 ? 's' : '') + ')';
        ratingEl.hidden = false;
      }
    }

    // Club recent activity feed
    var recentActivity = clubData.recent_activity || [];
    if (recentActivity.length > 0) {
      var feedEl = document.getElementById('dash-club-activity-feed');
      var feedList = document.getElementById('dash-club-feed-list');
      if (feedEl && feedList) {
        feedList.innerHTML = recentActivity.slice(0, 5).map(function (item) {
          var icon = item.type === 'review' ? '⭐' : item.type === 'discussion' ? '💬' : '👀';
          var timeAgo = item.timestamp ? getTimeAgo(item.timestamp) : '';
          var text = ProviderAuth.escapeHtml(item.summary || item.type);
          return '<li style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.6rem 0.75rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">' +
            '<span style="flex-shrink:0;font-size:1rem;">' + icon + '</span>' +
            '<div style="flex:1;min-width:0;">' +
              '<span style="font-size:0.88rem;color:var(--color-white);">' + text + '</span>' +
              (timeAgo ? '<span style="display:block;font-size:0.78rem;color:var(--color-text-muted);margin-top:0.15rem;">' + timeAgo + '</span>' : '') +
            '</div></li>';
        }).join('');
        feedEl.hidden = false;
      }
    }

    // Club engagement trend
    var trend = clubData.trend || null;
    if (trend) {
      var trendEl = document.getElementById('dash-club-trend');
      if (trendEl) {
        var trendIcon = trend === 'up' ? '📈' : trend === 'down' ? '📉' : '➡️';
        var trendText = trend === 'up' ? 'Engagement is increasing this week'
          : trend === 'down' ? 'Engagement has slowed this week'
          : 'Engagement is steady';
        document.getElementById('dash-club-trend-icon').textContent = trendIcon;
        document.getElementById('dash-club-trend-text').textContent = trendText;
        trendEl.hidden = false;
      }
    }

    // Club locked/unlocked
    const isCommunity = (p.tier || '').toUpperCase() === 'COMMUNITY';
    document.getElementById('dash-club-locked').hidden = isCommunity;
    document.getElementById('dash-club-unlocked').hidden = !isCommunity;

    // Last synced
    if (p.lastSynced) {
      const syncEl = document.getElementById('dash-club-last-synced');
      if (syncEl) {
        syncEl.textContent = 'Last synced: ' + new Date(p.lastSynced).toLocaleString();
        syncEl.hidden = false;
      }
    }

    // Trending badge in hero
    if (dashboardMeta.isTrending) {
      var trendBadge = document.getElementById('dash-trending-badge');
      if (trendBadge) trendBadge.hidden = false;
    }

    // Hide upgrade CTA for community tier
    if (isCommunity) {
      document.getElementById('dash-upgrade-cta').hidden = true;
    }

    // Render upgrade triggers
    renderTriggers(p);

    // View listing link
    if (p.slug) {
      document.getElementById('dash-view-listing-link').href = '/exchange/provider/' + p.slug;
    }

    // Bind edit form
    document.getElementById('dash-edit-form').addEventListener('submit', saveEdits);
  }

  function populateEditForm(p) {
    document.getElementById('dash-edit-name').value = p.name || '';
    document.getElementById('dash-edit-category').value = p.category || '';
    document.getElementById('dash-edit-format').value = p.format || '';
    document.getElementById('dash-edit-description').value = p.description || '';
    document.getElementById('dash-edit-city').value = p.city || '';
    document.getElementById('dash-edit-state').value = p.state || '';
    document.getElementById('dash-edit-country').value = p.country || '';
    document.getElementById('dash-edit-website').value = p.website || '';
    document.getElementById('dash-edit-phone').value = p.phone || '';
    document.getElementById('dash-edit-tags').value = (p.tags || []).join(', ');

    // Buy link (products only)
    const buyEl = document.getElementById('dash-edit-buylink');
    if (buyEl) buyEl.value = p.buyLink || '';

    // Ships to (products only)
    const ships = Array.isArray(p.shippingCountries) ? p.shippingCountries : [];
    document.querySelectorAll('[data-ships="dash"]').forEach(cb => {
      cb.checked = ships.includes(cb.value);
    });

    // Toggle product vs service fields
    toggleDashProductFields(p.category || '');
    const catSelect = document.getElementById('dash-edit-category');
    catSelect.addEventListener('change', function () { toggleDashProductFields(catSelect.value); });

    // Gate paid-only fields for free tier
    const isFree = (p.tier || 'FREE').toUpperCase() === 'FREE';
    document.querySelectorAll('.dash-paid-field').forEach(el => {
      if (isFree) {
        el.querySelectorAll('input, textarea, select').forEach(ctrl => {
          ctrl.disabled = true;
          if (ctrl.tagName === 'INPUT') ctrl.placeholder = 'Upgrade to $9/mo to edit';
        });
      }
    });

    // Show upgrade banner for non-COMMUNITY approved providers
    const currentTier = (p.tier || 'FREE').toUpperCase();
    if (currentTier !== 'COMMUNITY' && (p.status || '').toUpperCase() === 'APPROVED') {
      const banner = document.getElementById('dash-upgrade-banner');
      if (banner) banner.hidden = false;

      // If already VERIFIED, hide the Verified card and just show Club Partner upsell
      if (currentTier === 'VERIFIED') {
        const vCard = document.getElementById('dash-upgrade-verified-card');
        if (vCard) vCard.style.display = 'none';
        const title = document.getElementById('dash-upgrade-title');
        const sub = document.getElementById('dash-upgrade-subtitle');
        if (title) title.textContent = '🔥 Ready to build a following?';
        if (sub) sub.textContent = 'You\'re Verified. Become a Club Partner and members can follow you, see your posts, and join your conversation.';
      }

      wireUpgradeButton('dash-upgrade-verified-btn', 'VERIFIED');
      wireUpgradeButton('dash-upgrade-community-btn', 'COMMUNITY');
    }
  }

  function wireUpgradeButton(btnId, tier) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async function () {
      const errEl = document.getElementById('dash-upgrade-error');
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Redirecting…';
      if (window.ProviderTrack) ProviderTrack.track('upgrade_clicked', { source: 'dashboard_banner', tier: tier.toLowerCase() });
      try {
        const data = await ProviderAuth.apiCall('/provider/checkout-session', {
          method: 'POST',
          body: JSON.stringify({ tier }),
        });
        if (data && data.url) {
          window.location.href = data.url;
        } else {
          throw new Error('No checkout URL returned.');
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = originalText;
        if (errEl) {
          errEl.textContent = err.message || 'Could not start checkout. Please try again.';
          errEl.style.display = 'block';
        }
      }
    });
  }

  function toggleDashProductFields(category) {
    const isProduct = (category || '').startsWith('products');
    document.querySelectorAll('.dash-service-field').forEach(el => el.style.display = isProduct ? 'none' : '');
    document.querySelectorAll('.dash-product-field').forEach(el => el.style.display = isProduct ? '' : 'none');
  }

  function renderTriggers(p) {
    const container = document.getElementById('dash-triggers');
    const triggers = [];
    const signals = dashboardMeta.signals || {};
    const upgradeLevel = dashboardMeta.upgradeLevel || 'LOW';
    const isCommunity = (p.tier || '').toUpperCase() === 'COMMUNITY';

    // Upgrade level banner
    if (!isCommunity && upgradeLevel === 'HIGH') {
      triggers.push({ icon: '🔥', text: '<strong>You\'re getting strong attention right now</strong> — Your listing is gaining serious momentum.' });
      triggers.push({ icon: '⚡', text: 'This is a high-visibility moment for your listing.' });
    } else if (!isCommunity && upgradeLevel === 'MEDIUM') {
      triggers.push({ icon: '📈', text: '<strong>You\'re starting to gain visibility</strong> — Keep building to stand out.' });
    }

    // Backend signals
    if (signals.discovery) {
      const views = p.views || 0;
      triggers.push({ icon: '👀', text: '<strong>' + ProviderAuth.escapeHtml(signals.discovery) + '</strong> — ' + views + ' people have viewed your listing.' });
    }

    if (signals.discussion) {
      const disc = (p.clubData || {}).discussion_count || 0;
      triggers.push({ icon: '💬', text: '<strong>' + ProviderAuth.escapeHtml(signals.discussion) + '</strong> — ' + disc + ' discussion' + (disc !== 1 ? 's' : '') + ' mentioning your service.' });
    }

    if (signals.reviews) {
      const revs = (p.clubData || {}).review_count || 0;
      triggers.push({ icon: '⭐', text: '<strong>' + ProviderAuth.escapeHtml(signals.reviews) + '</strong> — ' + revs + ' review' + (revs !== 1 ? 's' : '') + ' about your service.' });
    }

    // Trending badge
    if (dashboardMeta.isTrending) {
      triggers.push({ icon: '🔥', text: '<strong>Trending</strong> — Your listing is one of the most active right now.' });
    }

    // Trending gap — not trending and not yet upgraded
    if (!dashboardMeta.isTrending && !isCommunity) {
      var gap = dashboardMeta.trendingScore || 0;
      if (gap > 10) {
        triggers.push({ icon: '📊', text: '<strong>You\'re close to trending in your area</strong> — A small push could put you on the radar.' });
      } else {
        triggers.push({ icon: '📊', text: 'You\'re not showing up in trending results yet. <a href="/pricing" style="color:#20b2aa;">Increase your visibility →</a>' });
      }
    }

    // Missing opportunity — discussions or reviews exist but they can't see them
    var hasClubActivity = ((p.clubData || {}).discussion_count || 0) > 0 || ((p.clubData || {}).review_count || 0) > 0;
    if (hasClubActivity && !isCommunity) {
      triggers.push({ icon: '💬', text: '<strong>You\'re missing what people are saying about services like yours</strong> — <a href="/pricing" style="color:#20b2aa;">Join the conversation in The Club →</a>' });
    }

    if (triggers.length === 0 && !isCommunity) {
      triggers.push({ icon: '🚀', text: '<strong>Get discovered faster</strong> — Upgrade to increase your visibility and join the conversation.' });
    }

    container.innerHTML = triggers.map(t =>
      '<div class="dash-trigger-card"><p>' + t.icon + ' ' + t.text + '</p></div>'
    ).join('');
  }

  async function saveEdits(e) {
    e.preventDefault();
    const errorEl = document.getElementById('dash-edit-error');
    const successEl = document.getElementById('dash-edit-success');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const btn = document.getElementById('dash-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const cat = document.getElementById('dash-edit-category').value;
    const isProduct = (cat || '').startsWith('products');

    const updates = {
      name: document.getElementById('dash-edit-name').value.trim(),
      category: cat,
      description: document.getElementById('dash-edit-description').value.trim(),
      phone: document.getElementById('dash-edit-phone').value.trim(),
      tags: document.getElementById('dash-edit-tags').value.trim(),
    };

    if (isProduct) {
      updates.format = 'product';
      updates.shippingCountries = Array.from(document.querySelectorAll('[data-ships="dash"]:checked')).map(cb => cb.value);
      const buyEl = document.getElementById('dash-edit-buylink');
      if (buyEl && !buyEl.disabled) updates.buyLink = buyEl.value.trim();
    } else {
      updates.format = document.getElementById('dash-edit-format').value;
      updates.city = document.getElementById('dash-edit-city').value.trim();
      updates.state = document.getElementById('dash-edit-state').value.trim();
      updates.country = document.getElementById('dash-edit-country').value.trim();
    }

    const websiteEl = document.getElementById('dash-edit-website');
    if (websiteEl && !websiteEl.disabled) updates.website = websiteEl.value.trim();

    try {
      await ProviderAuth.apiCall('/provider/update', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      successEl.textContent = 'Changes saved successfully.';
      successEl.style.display = 'block';

      // Track save event
      if (window.ProviderTrack) ProviderTrack.track('provider_update_saved');

      // Show post-action prompt
      const promptEl = document.getElementById('dash-post-action-prompt');
      if (promptEl && (providerData.tier || '').toUpperCase() !== 'COMMUNITY') {
        promptEl.hidden = false;
      }

      setTimeout(() => { successEl.style.display = 'none'; }, 4000);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  }

  function checkUpgradeSuccess() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === 'true') {
      const tier = (params.get('tier') || 'VERIFIED').toUpperCase();
      document.getElementById('dash-upgrade-success').hidden = false;
      // Customize success copy
      const titleEl = document.querySelector('#dash-upgrade-success .section-title');
      const bodyEl = document.querySelector('#dash-upgrade-success .text-muted');
      if (tier === 'COMMUNITY') {
        if (titleEl) titleEl.textContent = "🎉 You're a Club Partner";
        if (bodyEl) bodyEl.textContent = "Your provider club is being set up inside The Club. Members can now follow you, ask questions, and leave reviews.";
      } else {
        if (titleEl) titleEl.textContent = "🎉 You're Verified";
        if (bodyEl) bodyEl.textContent = "All listing fields are now unlocked. Polish your details so people can find and contact you.";
      }
      if (providerData && providerData.status === 'PENDING') {
        document.getElementById('dash-upgrade-pending-note').hidden = false;
      }
      if (window.ProviderTrack) ProviderTrack.track('upgrade_completed', { tier });
      window.history.replaceState({}, '', '/provider-dashboard');
    } else if (params.get('upgrade') === 'cancelled') {
      window.history.replaceState({}, '', '/provider-dashboard');
    }
  }

  function formatNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function getTimeAgo(timestamp) {
    var now = Date.now();
    var diff = now - new Date(timestamp).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    var weeks = Math.floor(days / 7);
    return weeks + 'w ago';
  }
})();
