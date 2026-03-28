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

    const updates = {
      name: document.getElementById('dash-edit-name').value.trim(),
      category: document.getElementById('dash-edit-category').value,
      format: document.getElementById('dash-edit-format').value,
      description: document.getElementById('dash-edit-description').value.trim(),
      city: document.getElementById('dash-edit-city').value.trim(),
      state: document.getElementById('dash-edit-state').value.trim(),
      country: document.getElementById('dash-edit-country').value.trim(),
      website: document.getElementById('dash-edit-website').value.trim(),
      phone: document.getElementById('dash-edit-phone').value.trim(),
      tags: document.getElementById('dash-edit-tags').value.trim(),
    };

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
      document.getElementById('dash-upgrade-success').hidden = false;
      if (providerData && providerData.status === 'PENDING') {
        document.getElementById('dash-upgrade-pending-note').hidden = false;
      }
      if (window.ProviderTrack) ProviderTrack.track('upgrade_completed', { tier: 'COMMUNITY' });
      window.history.replaceState({}, '', '/provider-dashboard');
    }
  }

  function formatNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
})();
