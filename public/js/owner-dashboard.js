/* ============================================================
   OWNER DASHBOARD (MISSION CONTROL) — Client-side logic
   Real-time growth, conversions, high-intent, approvals, trending
   ============================================================ */

(function () {
  'use strict';

  let allProviders = [];
  let rejectTargetId = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (!ProviderAuth.requireAuth('/admin/owner-dashboard')) return;
    verifyAdmin();
  }

  async function verifyAdmin() {
    try {
      const data = await ProviderAuth.apiCall('/admin/verify', { method: 'GET' });
      if (!data.isAdmin) { showDenied(); return; }

      document.getElementById('od-loading').hidden = true;
      document.getElementById('od-content').hidden = false;
      ProviderAuth.renderAuthBar(document.getElementById('pe-auth-bar-mount'));

      loadAll();
      bindModalEvents();
    } catch {
      showDenied();
    }
  }

  function showDenied() {
    document.getElementById('od-loading').hidden = true;
    document.getElementById('od-denied').hidden = false;
  }

  /* ── Parallel Data Loading ─────────────────────────────────── */

  function loadAll() {
    Promise.all([
      ProviderAuth.apiCall('/admin/owner-dashboard', { method: 'GET' }).catch(() => null),
      ProviderAuth.apiCall('/admin/high-intent', { method: 'GET' }).catch(() => null),
      ProviderAuth.apiCall('/admin/providers', { method: 'GET' }).catch(() => null),
    ]).then(function (results) {
      var dashboard = results[0];
      var highIntent = results[1];
      var providers = results[2];

      if (dashboard) {
        renderSnapshot(dashboard.snapshot);
        renderFunnel(dashboard.funnel);
        renderTrending(dashboard.trending || []);
        renderActivity(dashboard.recentEvents || []);
      }
      if (highIntent) renderHighIntent(highIntent.providers || []);
      if (providers) {
        allProviders = providers.providers || [];
        renderApprovalQueue();
      }
    });
  }

  /* ── Section 1: Today Snapshot ─────────────────────────────── */

  function renderSnapshot(s) {
    if (!s) return;
    setText('od-snap-claims', s.newClaimsToday);
    setText('od-snap-upgrades', s.upgradesToday);
    setText('od-snap-rate', s.upgradeRate + '%');
    setText('od-snap-intent', s.highIntentCount);
    setText('od-snap-pending', s.pendingCount);
    setText('od-snap-trending', s.trendingCount);

    // Color-code zeros
    toggleClass('od-snap-pending', 'od-snap-zero', s.pendingCount === 0);
    toggleClass('od-snap-intent', 'od-snap-zero', s.highIntentCount === 0);
  }

  /* ── Section 2: Funnel ─────────────────────────────────────── */

  function renderFunnel(f) {
    if (!f) return;
    setText('od-funnel-total', f.total_providers);
    setText('od-funnel-free', f.free_count);
    setText('od-funnel-verified', f.verified_count);
    setText('od-funnel-community', f.community_count);
    setText('od-funnel-rate', f.upgrade_rate + '%');
  }

  /* ── Section 3: High Intent ────────────────────────────────── */

  function renderHighIntent(providers) {
    var tbody = document.getElementById('od-intent-body');
    if (!providers.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">No high-intent providers right now.</td></tr>';
      return;
    }

    tbody.innerHTML = providers.map(function (p) {
      var name = esc(p.name || 'Unnamed');
      var email = esc(p.email || '—');
      var btnLabel = p.reminderSent ? 'Sent ✓' : 'Send Reminder';
      var btnDisabled = p.reminderSent ? ' disabled' : '';
      var btnClass = p.reminderSent ? 'admin-action-btn admin-action-flag' : 'admin-action-btn admin-action-approve';

      return '<tr>' +
        '<td class="admin-table-name">' + name + '</td>' +
        '<td>' + email + '</td>' +
        '<td><strong>' + p.upgradeScore + '</strong></td>' +
        '<td>' + p.views + '</td>' +
        '<td>' + p.discussion_count + '</td>' +
        '<td>' + p.review_count + '</td>' +
        '<td><span class="pe-tier pe-tier-' + p.tier.toLowerCase() + '">' + p.tier + '</span></td>' +
        '<td><div class="admin-table-actions">' +
          '<button class="' + btnClass + '" data-reminder-id="' + p.id + '"' + btnDisabled + '>' + btnLabel + '</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-reminder-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { sendReminder(btn); });
    });
  }

  async function sendReminder(btn) {
    var providerId = btn.dataset.reminderId;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      await ProviderAuth.apiCall('/admin/send-reminder', {
        method: 'POST',
        body: JSON.stringify({ providerId: providerId }),
      });
      btn.textContent = 'Sent ✓';
      btn.className = 'admin-action-btn admin-action-flag';
    } catch (err) {
      btn.textContent = 'Failed';
      btn.disabled = false;
      alert('Send failed: ' + err.message);
    }
  }

  /* ── Section 4: Approval Queue ─────────────────────────────── */

  function renderApprovalQueue() {
    var tbody = document.getElementById('od-approval-body');
    var pending = allProviders.filter(function (p) { return p.status === 'PENDING'; });

    // Sort oldest first
    pending.sort(function (a, b) {
      return (new Date(a.createdAt || 0)).getTime() - (new Date(b.createdAt || 0)).getTime();
    });

    if (!pending.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">No pending approvals. You\'re all caught up.</td></tr>';
      return;
    }

    tbody.innerHTML = pending.map(function (p) {
      var name = esc(p.name || 'Unnamed');
      var date = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—';
      var location = [p.city, p.state].filter(Boolean).join(', ') || '—';
      var tierClass = 'pe-tier pe-tier-' + (p.tier || 'free').toLowerCase();

      return '<tr>' +
        '<td class="admin-table-name">' + name + '</td>' +
        '<td>' + date + '</td>' +
        '<td><span class="' + tierClass + '">' + (p.tier || 'FREE') + '</span></td>' +
        '<td>' + esc(location) + '</td>' +
        '<td><div class="admin-table-actions">' +
          '<button class="admin-action-btn admin-action-approve" data-action="approve" data-id="' + p.id + '">Approve</button>' +
          '<button class="admin-action-btn admin-action-reject" data-action="reject" data-id="' + p.id + '">Reject</button>' +
          '<button class="admin-action-btn admin-action-flag" data-action="flag" data-id="' + p.id + '">Flag</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () { handleApprovalAction(btn.dataset.action, btn.dataset.id); });
    });
  }

  async function handleApprovalAction(action, providerId) {
    if (action === 'reject') {
      rejectTargetId = providerId;
      document.getElementById('od-reject-modal').classList.add('active');
      document.getElementById('od-reject-reason').value = '';
      document.getElementById('od-reject-reason').focus();
      return;
    }

    try {
      await ProviderAuth.apiCall('/admin/provider/' + action, {
        method: 'POST',
        body: JSON.stringify({ providerId: providerId }),
      });
      // Refresh providers list
      var data = await ProviderAuth.apiCall('/admin/providers', { method: 'GET' });
      allProviders = data.providers || [];
      renderApprovalQueue();
    } catch (err) {
      alert('Action failed: ' + err.message);
    }
  }

  function bindModalEvents() {
    document.getElementById('od-reject-cancel').addEventListener('click', closeRejectModal);
    document.getElementById('od-reject-confirm').addEventListener('click', confirmReject);
  }

  function closeRejectModal() {
    document.getElementById('od-reject-modal').classList.remove('active');
    rejectTargetId = null;
  }

  async function confirmReject() {
    var reason = document.getElementById('od-reject-reason').value.trim();
    if (!reason) { document.getElementById('od-reject-reason').focus(); return; }

    var btn = document.getElementById('od-reject-confirm');
    btn.disabled = true;

    try {
      await ProviderAuth.apiCall('/admin/provider/reject', {
        method: 'POST',
        body: JSON.stringify({ providerId: rejectTargetId, reason: reason }),
      });
      closeRejectModal();
      var data = await ProviderAuth.apiCall('/admin/providers', { method: 'GET' });
      allProviders = data.providers || [];
      renderApprovalQueue();
    } catch (err) {
      alert('Rejection failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Section 5: Trending Momentum ──────────────────────────── */

  function renderTrending(trending) {
    var tbody = document.getElementById('od-trending-body');
    if (!trending.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">No trending providers yet.</td></tr>';
      return;
    }

    tbody.innerHTML = trending.map(function (p, idx) {
      var name = esc(p.name || 'Unnamed');
      var link = p.slug ? '<a href="/exchange/provider/' + esc(p.slug) + '" target="_blank" style="color:#20B2AA;">' + name + '</a>' : name;

      return '<tr>' +
        '<td><strong>' + (idx + 1) + '</strong></td>' +
        '<td class="admin-table-name">' + link + '</td>' +
        '<td><strong>' + p.trendingScore + '</strong></td>' +
        '<td>' + p.views + '</td>' +
        '<td>' + p.discussion_count + '</td>' +
        '<td>' + p.review_count + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── Section 6: Recent Activity ────────────────────────────── */

  var EVENT_LABELS = {
    cta_join_club_clicked: '🎯 Join Club CTA clicked',
    pricing_viewed: '💰 Pricing page viewed',
    upgrade_started: '🚀 Upgrade started',
    upgrade_completed: '✅ Upgrade completed',
    claim_listing_clicked: '📋 Claim listing clicked',
    provider_update_saved: '💾 Listing updated',
    dashboard_viewed: '👀 Dashboard viewed',
    became_trending: '🔥 Became trending',
    lost_trending: '📉 Lost trending',
  };

  function renderActivity(events) {
    var container = document.getElementById('od-activity-feed');
    if (!events.length) {
      container.innerHTML = '<p class="text-muted">No recent events today.</p>';
      return;
    }

    container.innerHTML = events.map(function (ev) {
      var label = EVENT_LABELS[ev.eventName] || ev.eventName;
      var time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '';
      var tier = ev.tier ? '<span class="pe-tier pe-tier-' + ev.tier.toLowerCase() + '">' + ev.tier + '</span>' : '';

      return '<div class="od-activity-item">' +
        '<span class="od-activity-time">' + time + '</span>' +
        '<span class="od-activity-label">' + label + '</span>' +
        tier +
        '</div>';
    }).join('');
  }

  /* ── Helpers ───────────────────────────────────────────────── */

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value != null ? value : '—';
  }

  function toggleClass(id, cls, condition) {
    var el = document.getElementById(id);
    if (el) {
      if (condition) el.parentElement.classList.add(cls);
      else el.parentElement.classList.remove(cls);
    }
  }

  function esc(str) {
    return ProviderAuth.escapeHtml(str);
  }
})();
