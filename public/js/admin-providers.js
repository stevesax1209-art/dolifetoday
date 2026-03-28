/* ============================================================
   ADMIN PROVIDERS — Client-side logic
   Provider management panel with approve/reject/flag
   ============================================================ */

(function () {
  'use strict';

  let allProviders = [];
  let filteredProviders = [];
  let rejectTargetId = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (!ProviderAuth.requireAuth('/admin/providers')) return;
    verifyAdmin();
  }

  async function verifyAdmin() {
    try {
      const data = await ProviderAuth.apiCall('/admin/verify', { method: 'GET' });
      if (!data.isAdmin) {
        document.getElementById('admin-loading').hidden = true;
        document.getElementById('admin-denied').hidden = false;
        return;
      }

      document.getElementById('admin-loading').hidden = true;
      document.getElementById('admin-content').hidden = false;
      ProviderAuth.renderAuthBar(document.getElementById('pe-auth-bar-mount'));

      await loadProviders();
      bindEvents();
      loadConversionMetrics();
      loadHighIntentProviders();
    } catch {
      document.getElementById('admin-loading').hidden = true;
      document.getElementById('admin-denied').hidden = false;
    }
  }

  async function loadProviders() {
    try {
      const data = await ProviderAuth.apiCall('/admin/providers', { method: 'GET' });
      allProviders = data.providers || [];
      applyFilters();
      renderStats();
    } catch (err) {
      document.getElementById('admin-table-body').innerHTML =
        '<tr><td colspan="6" class="admin-empty">Error loading providers: ' + ProviderAuth.escapeHtml(err.message) + '</td></tr>';
    }
  }

  function bindEvents() {
    document.getElementById('admin-search').addEventListener('input', debounce(applyFilters, 300));
    document.getElementById('admin-filter-status').addEventListener('change', applyFilters);
    document.getElementById('admin-filter-tier').addEventListener('change', applyFilters);
    document.getElementById('admin-filter-category').addEventListener('change', applyFilters);
    document.getElementById('admin-filter-sort').addEventListener('change', applyFilters);

    document.getElementById('admin-reject-cancel').addEventListener('click', closeRejectModal);
    document.getElementById('admin-reject-confirm').addEventListener('click', confirmReject);
  }

  function applyFilters() {
    const search = (document.getElementById('admin-search').value || '').toLowerCase().trim();
    const status = document.getElementById('admin-filter-status').value;
    const tier = document.getElementById('admin-filter-tier').value;
    const category = document.getElementById('admin-filter-category').value;

    filteredProviders = allProviders.filter(p => {
      if (search && !(p.name || '').toLowerCase().includes(search) && !(p.email || '').toLowerCase().includes(search)) return false;
      if (status !== 'all' && p.status !== status) return false;
      if (tier !== 'all' && p.tier !== tier) return false;
      if (category !== 'all' && p.category !== category) return false;
      return true;
    });

    // Sort
    const sort = (document.getElementById('admin-filter-sort') || {}).value || 'newest';
    if (sort === 'high-intent') {
      filteredProviders = filteredProviders.filter(p => (p.upgradeScore || 0) > 30 && (p.tier || '').toUpperCase() !== 'COMMUNITY');
      filteredProviders.sort((a, b) => (b.upgradeScore || 0) - (a.upgradeScore || 0));
    } else if (sort === 'most-active') {
      filteredProviders.sort((a, b) => (b.upgradeScore || 0) - (a.upgradeScore || 0));
    } else if (sort === 'name') {
      filteredProviders.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    // 'newest' is default order from backend

    renderTable();
  }

  function renderStats() {
    const counts = { total: allProviders.length, PENDING: 0, APPROVED: 0, REJECTED: 0, FLAGGED: 0 };
    allProviders.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

    document.getElementById('admin-stat-total').textContent = counts.total;
    document.getElementById('admin-stat-pending').textContent = counts.PENDING;
    document.getElementById('admin-stat-approved').textContent = counts.APPROVED;
    document.getElementById('admin-stat-rejected').textContent = counts.REJECTED;
    document.getElementById('admin-stat-flagged').textContent = counts.FLAGGED;
  }

  function renderTable() {
    const tbody = document.getElementById('admin-table-body');

    if (filteredProviders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">No providers match your filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filteredProviders.map(p => {
      const name = ProviderAuth.escapeHtml(p.name || 'Unnamed');
      const status = p.status || 'PENDING';
      const tier = p.tier || 'FREE';
      const category = ProviderAuth.escapeHtml(p.category || '—');
      const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—';
      const statusClass = 'pe-status pe-status-' + status.toLowerCase();
      const tierClass = 'pe-tier pe-tier-' + tier.toLowerCase();
      const score = p.upgradeScore != null ? p.upgradeScore : '—';
      const disc = p.discussion_count != null ? p.discussion_count : '—';
      const rev = p.review_count != null ? p.review_count : '—';

      let actions = '';
      if (status === 'PENDING' || status === 'FLAGGED') {
        actions += '<button class="admin-action-btn admin-action-approve" data-action="approve" data-id="' + p.id + '">Approve</button>';
      }
      if (status !== 'REJECTED') {
        actions += '<button class="admin-action-btn admin-action-reject" data-action="reject" data-id="' + p.id + '">Reject</button>';
      }
      if (status === 'APPROVED') {
        actions += '<button class="admin-action-btn admin-action-flag" data-action="flag" data-id="' + p.id + '">Flag</button>';
      }

      return '<tr>' +
        '<td class="admin-table-name">' + name + '</td>' +
        '<td><span class="' + statusClass + '">' + status + '</span></td>' +
        '<td><span class="' + tierClass + '">' + tier + '</span></td>' +
        '<td>' + category + '</td>' +
        '<td>' + score + '</td>' +
        '<td>' + disc + '</td>' +
        '<td>' + rev + '</td>' +
        '<td>' + date + '</td>' +
        '<td><div class="admin-table-actions">' + actions + '</div></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleAction(action, providerId) {
    if (action === 'reject') {
      rejectTargetId = providerId;
      document.getElementById('admin-reject-modal').classList.add('active');
      document.getElementById('admin-reject-reason').value = '';
      document.getElementById('admin-reject-reason').focus();
      return;
    }

    try {
      await ProviderAuth.apiCall('/admin/provider/' + action, {
        method: 'POST',
        body: JSON.stringify({ providerId }),
      });
      await loadProviders();
    } catch (err) {
      alert('Action failed: ' + err.message);
    }
  }

  function closeRejectModal() {
    document.getElementById('admin-reject-modal').classList.remove('active');
    rejectTargetId = null;
  }

  async function confirmReject() {
    const reason = document.getElementById('admin-reject-reason').value.trim();
    if (!reason) {
      document.getElementById('admin-reject-reason').focus();
      return;
    }

    const btn = document.getElementById('admin-reject-confirm');
    btn.disabled = true;

    try {
      await ProviderAuth.apiCall('/admin/provider/reject', {
        method: 'POST',
        body: JSON.stringify({ providerId: rejectTargetId, reason }),
      });
      closeRejectModal();
      await loadProviders();
    } catch (err) {
      alert('Rejection failed: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      const args = arguments;
      const ctx = this;
      timer = setTimeout(() => fn.apply(ctx, args), ms);
    };
  }

  /* ── Conversion Metrics ────────────────────────────────────── */

  async function loadConversionMetrics() {
    try {
      const data = await ProviderAuth.apiCall('/admin/conversion-metrics', { method: 'GET' });
      document.getElementById('admin-metric-total').textContent = data.total_providers;
      document.getElementById('admin-metric-free').textContent = data.free_count;
      document.getElementById('admin-metric-verified').textContent = data.verified_count;
      document.getElementById('admin-metric-community').textContent = data.community_count;
      document.getElementById('admin-metric-rate').textContent = data.upgrade_rate + '%';
    } catch {
      document.getElementById('admin-metric-total').textContent = '—';
    }
  }

  /* ── High Intent Providers ─────────────────────────────────── */

  async function loadHighIntentProviders() {
    const tbody = document.getElementById('admin-high-intent-body');
    try {
      const data = await ProviderAuth.apiCall('/admin/high-intent', { method: 'GET' });
      const providers = data.providers || [];

      if (providers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">No high-intent providers found.</td></tr>';
        return;
      }

      tbody.innerHTML = providers.map(p => {
        const name = ProviderAuth.escapeHtml(p.name || 'Unnamed');
        const email = ProviderAuth.escapeHtml(p.email || '—');
        const btnLabel = p.reminderSent ? 'Sent ✓' : 'Send Reminder';
        const btnDisabled = p.reminderSent ? ' disabled' : '';
        const btnClass = p.reminderSent ? 'admin-action-btn admin-action-flag' : 'admin-action-btn admin-action-approve';

        return '<tr>' +
          '<td class="admin-table-name">' + name + '</td>' +
          '<td>' + email + '</td>' +
          '<td><span class="pe-tier pe-tier-' + p.tier.toLowerCase() + '">' + p.tier + '</span></td>' +
          '<td>' + p.upgradeScore + '</td>' +
          '<td>' + p.views + '</td>' +
          '<td>' + p.discussion_count + '</td>' +
          '<td>' + p.review_count + '</td>' +
          '<td><button class="' + btnClass + '" data-reminder-id="' + p.id + '"' + btnDisabled + '>' + btnLabel + '</button></td>' +
          '</tr>';
      }).join('');

      tbody.querySelectorAll('[data-reminder-id]').forEach(btn => {
        btn.addEventListener('click', () => sendReminder(btn));
      });
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">Error: ' + ProviderAuth.escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function sendReminder(btn) {
    const providerId = btn.dataset.reminderId;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      await ProviderAuth.apiCall('/admin/send-reminder', {
        method: 'POST',
        body: JSON.stringify({ providerId }),
      });
      btn.textContent = 'Sent ✓';
      btn.className = 'admin-action-btn admin-action-flag';
    } catch (err) {
      btn.textContent = 'Failed';
      btn.disabled = false;
      alert('Send failed: ' + err.message);
    }
  }
})();
