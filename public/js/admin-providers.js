/* ============================================================
   ADMIN PROVIDERS — Client-side logic
   Provider management panel with approve/reject/flag
   ============================================================ */

(function () {
  'use strict';

  let allProviders = [];
  let filteredProviders = [];
  let rejectTargetId = null;
  let editTargetId = null;
  let deleteTargetId = null;
  let tierTargetId = null;

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

    // Add Provider
    document.getElementById('admin-add-provider-btn').addEventListener('click', openAddModal);
    document.getElementById('admin-add-cancel').addEventListener('click', () => closeModal('admin-add-modal'));
    document.getElementById('admin-add-confirm').addEventListener('click', confirmAddProvider);

    // Edit Provider
    document.getElementById('admin-edit-cancel').addEventListener('click', () => closeModal('admin-edit-modal'));
    document.getElementById('admin-edit-confirm').addEventListener('click', confirmEditProvider);

    // Delete Provider
    document.getElementById('admin-delete-cancel').addEventListener('click', () => closeModal('admin-delete-modal'));
    document.getElementById('admin-delete-confirm').addEventListener('click', confirmDeleteProvider);

    // Set Tier
    document.getElementById('admin-tier-cancel').addEventListener('click', () => closeModal('admin-tier-modal'));
    document.getElementById('admin-tier-confirm').addEventListener('click', confirmSetTier);
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
      if (category !== 'all') {
        if (category === 'products') {
          if (!(p.category || '').startsWith('products')) return false;
        } else if (p.category !== category) return false;
      }
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
      tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">No providers match your filters.</td></tr>';
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
      actions += '<button class="admin-action-btn admin-action-edit" data-action="edit" data-id="' + p.id + '">Edit</button>';
      actions += '<button class="admin-action-btn admin-action-tier" data-action="set-tier" data-id="' + p.id + '">Tier</button>';
      actions += '<button class="admin-action-btn admin-action-delete" data-action="delete" data-id="' + p.id + '">Delete</button>';

      // Build claim info row if this is a claim
      let claimRow = '';
      if (p.claimedBy) {
        const claimEmail = ProviderAuth.escapeHtml(p.claimEmail || '—');
        const claimEmailRaw = p.claimEmail || '';
        const claimRole = ProviderAuth.escapeHtml(p.claimRole || '—');
        const claimPhone = ProviderAuth.escapeHtml(p.claimPhone || '—');
        const extId = ProviderAuth.escapeHtml(p.externalProviderId || '');
        const extWebsite = p.externalWebsite || '';
        const extPhone = p.externalPhone || '';
        const extLocation = p.externalLocation || '';
        const extType = p.externalType || '';
        const exchangeLink = extId ? '<a href="https://dolifetoday.com/exchange/provider?id=' + encodeURIComponent(p.externalProviderId) + '" target="_blank" rel="noopener" style="color:#1f7a8c;">View Exchange Listing ↗</a>' : '—';

        // Prefer server-computed signals (from submission time); fall back
        // to client re-computation for legacy claims created before the
        // vetting fields were added.
        const serverV = p.claimVetting || null;
        const signals = serverV ? {
          domain: serverV.domainMatch,
          personalEmail: !!serverV.isPersonalEmail,
          nameMatch: false,
          autoVerified: !!serverV.autoVerified,
          pdRelevanceLikely: !!serverV.pdRelevanceLikely,
        } : computeVettingSignals(claimEmailRaw, extWebsite, p.name || '');
        if (!serverV) {
          signals.autoVerified = signals.domain === 'match' && !signals.personalEmail;
          signals.pdRelevanceLikely = looksParkinsonsRelevant((p.name || '') + ' ' + extType);
        }

        const verdictBanner = signals.autoVerified
          ? '<div style="margin-bottom:.5rem;padding:.5rem .75rem;background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;color:#065f46;font-weight:600;font-size:.85rem;">✅ Auto-verified — claimant\'s email domain matches the listed website. Safe to approve.</div>'
          : '<div style="margin-bottom:.5rem;padding:.5rem .75rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;color:#78350f;font-weight:600;font-size:.85rem;">🔍 Manual review needed — could not automatically verify this claim. Read the claimant statement below.</div>';

        const signalPills = renderSignalPills(signals);

        // Claimant relevance statement (present when not auto-verified)
        const statement = (p.claimRelevanceStatement || '').trim();
        const statementBlock = statement ? (
          '<div style="margin-top:.5rem;padding:.5rem .75rem;background:#fff;border-left:3px solid #b8711a;border-radius:0 4px 4px 0;font-size:.88rem;color:#333;">' +
            '<strong style="color:#78350f;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;">Claimant\'s Parkinson\'s relevance statement</strong>' +
            '<div style="margin-top:.25rem;font-style:italic;white-space:pre-wrap;">' + ProviderAuth.escapeHtml(statement) + '</div>' +
          '</div>'
        ) : '';

        const listedRow = (extWebsite || extPhone || extLocation) ? (
          '<div style="margin-top:.5rem;padding-top:.5rem;border-top:1px dashed #f0d4a8;display:flex;flex-wrap:wrap;gap:.5rem 2rem;font-size:.85rem;line-height:1.7;color:#555;">' +
            '<span><strong>Listed website:</strong> ' + (extWebsite ? '<a href="' + ProviderAuth.escapeHtml(normalizeUrl(extWebsite)) + '" target="_blank" rel="noopener" style="color:#1f7a8c;">' + ProviderAuth.escapeHtml(extWebsite) + ' ↗</a>' : '<em>—</em>') + '</span>' +
            '<span><strong>Listed phone:</strong> ' + ProviderAuth.escapeHtml(extPhone || '—') + '</span>' +
            '<span><strong>Listed location:</strong> ' + ProviderAuth.escapeHtml(extLocation || '—') + '</span>' +
            (extType ? '<span><strong>Type:</strong> ' + ProviderAuth.escapeHtml(extType) + '</span>' : '') +
          '</div>'
        ) : '';

        const dueDiligence = (
          '<div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.4rem;font-size:.8rem;">' +
            '<a href="https://www.google.com/search?q=' + encodeURIComponent('"' + (p.name || '') + '" parkinson') + '" target="_blank" rel="noopener" style="background:#fff;border:1px solid #d1c4a8;color:#78350f;padding:2px 8px;border-radius:3px;text-decoration:none;">🔍 Google name</a>' +
            (claimEmailRaw ? '<a href="https://www.google.com/search?q=' + encodeURIComponent('"' + claimEmailRaw + '"') + '" target="_blank" rel="noopener" style="background:#fff;border:1px solid #d1c4a8;color:#78350f;padding:2px 8px;border-radius:3px;text-decoration:none;">🔍 Search email</a>' : '') +
            (extWebsite ? '<a href="' + ProviderAuth.escapeHtml(normalizeUrl(extWebsite)) + '" target="_blank" rel="noopener" style="background:#fff;border:1px solid #d1c4a8;color:#78350f;padding:2px 8px;border-radius:3px;text-decoration:none;">🌐 Open website</a>' : '') +
            (claimEmailRaw ? '<a href="mailto:' + encodeURIComponent(claimEmailRaw) + '" style="background:#fff;border:1px solid #d1c4a8;color:#78350f;padding:2px 8px;border-radius:3px;text-decoration:none;">✉️ Email claimant</a>' : '') +
          '</div>'
        );

        claimRow = '<tr class="admin-claim-row"><td colspan="6" style="padding:.75rem 1rem;background:#fef9e7;color:#333;border-bottom:2px solid #f0d4a8;">' +
          verdictBanner +
          '<div style="display:flex;flex-wrap:wrap;gap:.5rem 2rem;font-size:.9rem;line-height:1.7;align-items:center;">' +
          '<span><strong style="color:#b8711a;">📋 Claim Request</strong></span>' +
          signalPills +
          '<span><strong>Email:</strong> ' + claimEmail + '</span>' +
          '<span><strong>Role:</strong> ' + claimRole + '</span>' +
          '<span><strong>Phone:</strong> ' + claimPhone + '</span>' +
          '<span>' + exchangeLink + '</span>' +
          '</div>' +
          statementBlock +
          listedRow +
          dueDiligence +
          '</td></tr>';
      }

      return '<tr>' +
        '<td class="admin-table-name">' + name + (p.claimedBy ? ' <span style="font-size:.7rem;background:#fef3e6;color:#b8711a;padding:1px 6px;border-radius:3px;font-weight:600;">CLAIM</span>' : '') + '</td>' +
        '<td><span class="' + statusClass + '">' + status + '</span></td>' +
        '<td><span class="' + tierClass + '">' + tier + '</span></td>' +
        '<td>' + category + '</td>' +
        '<td>' + date + '</td>' +
        '<td><div class="admin-table-actions">' + actions + '</div></td>' +
        '</tr>' + claimRow;
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

    if (action === 'edit') {
      openEditModal(providerId);
      return;
    }

    if (action === 'delete') {
      openDeleteModal(providerId);
      return;
    }

    if (action === 'set-tier') {
      openTierModal(providerId);
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

  function closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  function isProductCategory(val) {
    return (val || '').startsWith('products');
  }

  function toggleProductFields(prefix, category) {
    const isProduct = isProductCategory(category);
    document.querySelectorAll('.' + prefix + '-service-field').forEach(el => el.style.display = isProduct ? 'none' : '');
    document.querySelectorAll('.' + prefix + '-product-field').forEach(el => el.style.display = isProduct ? '' : 'none');
  }

  function getShipsTo(prefix) {
    return Array.from(document.querySelectorAll('[data-ships="' + prefix + '"]:checked')).map(cb => cb.value);
  }

  function setShipsTo(prefix, values) {
    const list = Array.isArray(values) ? values : [];
    document.querySelectorAll('[data-ships="' + prefix + '"]').forEach(cb => {
      cb.checked = list.includes(cb.value);
    });
  }

  /* ── Add Provider ──────────────────────────────────────────── */

  function openAddModal() {
    ['add-name', 'add-city', 'add-state', 'add-website', 'add-phone', 'add-email', 'add-tags', 'add-description', 'add-buylink'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('add-country').value = 'US';
    document.getElementById('add-category').value = 'exercise';
    document.getElementById('add-format').value = 'in-person';
    document.getElementById('add-tier').value = 'FREE';
    setShipsTo('add', []);
    toggleProductFields('add', 'exercise');

    const catSelect = document.getElementById('add-category');
    catSelect.onchange = function () { toggleProductFields('add', catSelect.value); };

    document.getElementById('admin-add-modal').classList.add('active');
    document.getElementById('add-name').focus();
  }

  async function confirmAddProvider() {
    const name = document.getElementById('add-name').value.trim();
    if (!name) { document.getElementById('add-name').focus(); return; }

    const btn = document.getElementById('admin-add-confirm');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
      const cat = document.getElementById('add-category').value;
      const payload = {
        name,
        category: cat,
        description: document.getElementById('add-description').value.trim(),
        website: document.getElementById('add-website').value.trim(),
        phone: document.getElementById('add-phone').value.trim(),
        contactEmail: document.getElementById('add-email').value.trim(),
        tags: document.getElementById('add-tags').value.trim(),
        tier: document.getElementById('add-tier').value,
      };

      if (isProductCategory(cat)) {
        payload.format = 'product';
        payload.shippingCountries = getShipsTo('add');
        payload.buyLink = document.getElementById('add-buylink').value.trim();
      } else {
        payload.format = document.getElementById('add-format').value;
        payload.city = document.getElementById('add-city').value.trim();
        payload.state = document.getElementById('add-state').value.trim();
        payload.country = document.getElementById('add-country').value.trim();
      }

      await ProviderAuth.apiCall('/admin/provider/add', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      closeModal('admin-add-modal');
      await loadProviders();
    } catch (err) {
      alert('Failed to add provider: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Provider';
    }
  }

  /* ── Edit Provider ─────────────────────────────────────────── */

  function openEditModal(providerId) {
    const provider = allProviders.find(p => p.id === providerId);
    if (!provider) return;
    editTargetId = providerId;

    document.getElementById('edit-name').value = provider.name || '';
    document.getElementById('edit-category').value = provider.category || 'other';
    document.getElementById('edit-format').value = provider.format || 'in-person';
    document.getElementById('edit-city').value = provider.city || '';
    document.getElementById('edit-state').value = provider.state || '';
    document.getElementById('edit-country').value = provider.country || '';
    document.getElementById('edit-description').value = provider.description || '';
    document.getElementById('edit-website').value = provider.website || '';
    document.getElementById('edit-phone').value = provider.phone || '';
    document.getElementById('edit-email').value = provider.contactEmail || '';
    document.getElementById('edit-tags').value = Array.isArray(provider.tags) ? provider.tags.join(', ') : '';
    document.getElementById('edit-buylink').value = provider.buyLink || '';
    setShipsTo('edit', provider.shippingCountries || []);
    toggleProductFields('edit', provider.category || 'other');

    const catSelect = document.getElementById('edit-category');
    catSelect.onchange = function () { toggleProductFields('edit', catSelect.value); };

    document.getElementById('admin-edit-modal').classList.add('active');
    document.getElementById('edit-name').focus();
  }

  async function confirmEditProvider() {
    if (!editTargetId) return;
    const btn = document.getElementById('admin-edit-confirm');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const cat = document.getElementById('edit-category').value;
      const payload = {
        providerId: editTargetId,
        name: document.getElementById('edit-name').value.trim(),
        category: cat,
        description: document.getElementById('edit-description').value.trim(),
        website: document.getElementById('edit-website').value.trim(),
        phone: document.getElementById('edit-phone').value.trim(),
        contactEmail: document.getElementById('edit-email').value.trim(),
        tags: document.getElementById('edit-tags').value.trim(),
      };

      if (isProductCategory(cat)) {
        payload.format = 'product';
        payload.shippingCountries = getShipsTo('edit');
        payload.buyLink = document.getElementById('edit-buylink').value.trim();
      } else {
        payload.format = document.getElementById('edit-format').value;
        payload.city = document.getElementById('edit-city').value.trim();
        payload.state = document.getElementById('edit-state').value.trim();
        payload.country = document.getElementById('edit-country').value.trim();
      }

      await ProviderAuth.apiCall('/admin/provider/edit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      closeModal('admin-edit-modal');
      editTargetId = null;
      await loadProviders();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  }

  /* ── Delete Provider ───────────────────────────────────────── */

  function openDeleteModal(providerId) {
    const provider = allProviders.find(p => p.id === providerId);
    if (!provider) return;
    deleteTargetId = providerId;
    document.getElementById('admin-delete-name').textContent = provider.name || 'this provider';
    document.getElementById('admin-delete-modal').classList.add('active');
  }

  async function confirmDeleteProvider() {
    if (!deleteTargetId) return;
    const btn = document.getElementById('admin-delete-confirm');
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    try {
      await ProviderAuth.apiCall('/admin/provider/delete', {
        method: 'POST',
        body: JSON.stringify({ providerId: deleteTargetId }),
      });
      closeModal('admin-delete-modal');
      deleteTargetId = null;
      await loadProviders();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete Provider';
    }
  }

  /* ── Set Tier ──────────────────────────────────────────────── */

  function openTierModal(providerId) {
    const provider = allProviders.find(p => p.id === providerId);
    if (!provider) return;
    tierTargetId = providerId;
    document.getElementById('admin-tier-provider-name').textContent = provider.name || 'Provider';
    document.getElementById('admin-tier-select').value = provider.tier || 'FREE';
    document.getElementById('admin-tier-modal').classList.add('active');
  }

  async function confirmSetTier() {
    if (!tierTargetId) return;
    const tier = document.getElementById('admin-tier-select').value;
    const btn = document.getElementById('admin-tier-confirm');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      await ProviderAuth.apiCall('/admin/provider/set-tier', {
        method: 'POST',
        body: JSON.stringify({ providerId: tierTargetId, tier }),
      });
      closeModal('admin-tier-modal');
      tierTargetId = null;
      await loadProviders();
    } catch (err) {
      alert('Set tier failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Set Tier';
    }
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

  /* ── Claim vetting signals ────────────────────────────────── */

  // Free/personal email providers — claims from these need extra scrutiny
  // because they don't tie the claimant to the organization's domain.
  const PERSONAL_EMAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
    'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
    'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me',
    'mail.com', 'gmx.com', 'zoho.com', 'yandex.com', 'fastmail.com',
    'hey.com', 'tutanota.com', 'pm.me',
  ]);

  function extractDomain(input) {
    if (!input) return '';
    let s = String(input).trim().toLowerCase();
    if (s.includes('@')) s = s.split('@').pop();
    s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
    s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
    return s;
  }

  function normalizeUrl(input) {
    if (!input) return '';
    const s = String(input).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return 'https://' + s;
  }

  // Match the "root" part of a domain (drop TLD + common second-level TLDs).
  // e.g. corteizrtw.com → "corteizrtw"; example.co.uk → "example"
  function domainRoot(domain) {
    if (!domain) return '';
    const parts = domain.split('.');
    if (parts.length < 2) return domain;
    // crude second-level TLD list — good enough for signal comparison
    const secondLevelTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
    if (parts.length >= 3 && secondLevelTlds.has(parts[parts.length - 2])) {
      return parts[parts.length - 3];
    }
    return parts[parts.length - 2];
  }

  function nameTokens(name) {
    if (!name) return [];
    return String(name).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !['the', 'and', 'for', 'with', 'inc', 'llc', 'ltd', 'corp', 'group', 'center', 'clinic', 'health', 'care'].includes(t));
  }

  function computeVettingSignals(claimEmail, listedWebsite, providerName) {
    const out = { domain: null, personalEmail: false, nameMatch: false };
    const emailDomain = extractDomain(claimEmail);
    const siteDomain = extractDomain(listedWebsite);

    if (emailDomain) {
      out.personalEmail = PERSONAL_EMAIL_DOMAINS.has(emailDomain);
    }

    if (emailDomain && siteDomain) {
      if (emailDomain === siteDomain) {
        out.domain = 'match';
      } else if (domainRoot(emailDomain) && domainRoot(emailDomain) === domainRoot(siteDomain)) {
        out.domain = 'match';
      } else {
        out.domain = 'mismatch';
      }
    } else if (emailDomain && !siteDomain && !out.personalEmail) {
      // No website to compare; noted separately by "no website" state
      out.domain = 'nowebsite';
    }

    // Name-in-email heuristic: any 4+ char token from provider name appears
    // in the email address (local part OR domain). Weak but useful signal
    // when domain match is unavailable (e.g. gmail claimant using
    // "corteizspains@gmail.com" for a business named "Corteiz").
    if (claimEmail && providerName) {
      const email = String(claimEmail).toLowerCase();
      const tokens = nameTokens(providerName);
      out.nameMatch = tokens.some(t => email.includes(t));
    }

    return out;
  }

  function pill(bg, border, color, icon, text) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:' + bg +
      ';border:1px solid ' + border + ';color:' + color +
      ';padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600;line-height:1.4;">' +
      icon + ' ' + text + '</span>';
  }

  function renderSignalPills(signals) {
    const pills = [];
    if (signals.domain === 'match') {
      pills.push(pill('#d1fae5', '#6ee7b7', '#065f46', '✅', 'Email domain matches website'));
    } else if (signals.domain === 'mismatch') {
      pills.push(pill('#fee2e2', '#fca5a5', '#991b1b', '⚠️', 'Email domain ≠ website'));
    } else if (signals.domain === 'nowebsite') {
      pills.push(pill('#e5e7eb', '#9ca3af', '#374151', 'ℹ️', 'No listed website to compare'));
    }
    if (signals.personalEmail) {
      pills.push(pill('#fef3c7', '#fcd34d', '#78350f', '🟡', 'Personal email'));
    }
    if (signals.nameMatch) {
      pills.push(pill('#dbeafe', '#93c5fd', '#1e3a8a', '✦', 'Name in email'));
    }
    if (signals.pdRelevanceLikely === true) {
      pills.push(pill('#dcfce7', '#86efac', '#166534', '🧠', "PD-relevant keywords"));
    } else if (signals.pdRelevanceLikely === false) {
      pills.push(pill('#fee2e2', '#fca5a5', '#991b1b', '❔', "No PD keywords in listing"));
    }
    return pills.join(' ');
  }

  // Same keyword list used server-side in assessProviderClaim — keep in sync.
  const PD_RELEVANCE_KEYWORDS = [
    'parkinson', "parkinson\u2019s", ' pd ', 'movement disorder', 'neurology',
    'neurologist', 'physical therapy', 'occupational therapy', 'speech therapy',
    'lsvt', 'pwr', 'rock steady', 'boxing for parkinson', 'dbs', 'deep brain',
    'levodopa', 'carbidopa', 'sinemet', 'tremor', 'dyskinesia', 'dystonia',
    'freezing of gait', 'caregiver', 'care partner', 'support group',
    'brain health', 'geriatric', 'wellness', 'rehab', 'physiotherapy',
    'balance', 'gait', 'apda', 'michael j fox', 'davis phinney',
    'pmd alliance', 'dance for pd', 'tai chi', 'mindful',
  ];

  function looksParkinsonsRelevant(text) {
    const s = (' ' + String(text || '').toLowerCase() + ' ');
    return PD_RELEVANCE_KEYWORDS.some(k => s.includes(k));
  }
})();
