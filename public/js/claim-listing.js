/* ============================================================
   CLAIM LISTING — Client-side logic
   Search for existing providers, verify, and submit claim
   ============================================================ */

(function () {
  'use strict';

  const API_BASE = 'https://club.dolifetoday.com/api/exchange/providers';
  const PERSONAL_EMAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
    'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
    'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'mail.com',
    'gmx.com', 'zoho.com', 'yandex.com', 'fastmail.com', 'hey.com',
  ]);
  let allProviders = [];
  let selectedProvider = null;
  let authMode = 'signin';
  let currentStep = 1;
  let relevanceRequired = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');

    if (ProviderAuth.isAuthenticated()) {
      showFlowView();
      ProviderAuth.renderAuthBar(document.getElementById('pe-auth-bar-mount'));
      loadProviders();
    } else {
      showAuthView(authParam === 'signin' ? 'signin' : 'signup');
    }

    bindAuthForm();
    bindFlowEvents();
  }

  function showAuthView(mode) {
    document.getElementById('claim-auth-view').hidden = false;
    document.getElementById('claim-flow-view').hidden = true;
    setAuthMode(mode || 'signin');
  }

  function showFlowView() {
    document.getElementById('claim-auth-view').hidden = true;
    document.getElementById('claim-flow-view').hidden = false;

    const params = new URLSearchParams(window.location.search);
    const providerId = params.get('provider');
    if (providerId) {
      loadProviders().then(() => {
        const match = allProviders.find(p => p.id === providerId || p.slug === providerId);
        if (match) selectProvider(match);
      });
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const nameField = document.getElementById('claim-name-field');
    const submitBtn = document.getElementById('claim-auth-submit');
    const signinTab = document.getElementById('claim-tab-signin');
    const signupTab = document.getElementById('claim-tab-signup');
    const heading = document.getElementById('claim-auth-heading');

    if (mode === 'signup') {
      nameField.hidden = false;
      submitBtn.textContent = 'Create Account';
      signinTab.className = 'btn btn-outline-primary btn-sm';
      signupTab.className = 'btn btn-primary btn-sm';
      heading.textContent = 'Create an account to claim your listing';
    } else {
      nameField.hidden = true;
      submitBtn.textContent = 'Sign In';
      signinTab.className = 'btn btn-primary btn-sm';
      signupTab.className = 'btn btn-outline-primary btn-sm';
      heading.textContent = 'Sign in to claim your listing';
    }
  }

  function bindAuthForm() {
    document.getElementById('claim-tab-signin').addEventListener('click', () => setAuthMode('signin'));
    document.getElementById('claim-tab-signup').addEventListener('click', () => setAuthMode('signup'));

    document.getElementById('claim-auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('claim-auth-error');
      errorEl.style.display = 'none';

      const email = document.getElementById('claim-auth-email').value.trim();
      const password = document.getElementById('claim-auth-password').value;
      const name = document.getElementById('claim-auth-name').value.trim();

      if (!email || !password) {
        errorEl.textContent = 'Please fill in all fields.';
        errorEl.style.display = 'block';
        return;
      }

      if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters.';
        errorEl.style.display = 'block';
        return;
      }

      const submitBtn = document.getElementById('claim-auth-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait...';

      try {
        if (authMode === 'signup') {
          if (!name) {
            errorEl.textContent = 'Please enter your name.';
            errorEl.style.display = 'block';
            return;
          }
          await ProviderAuth.signUp(email, password, name);
        } else {
          await ProviderAuth.signIn(email, password);
        }
        showFlowView();
        ProviderAuth.renderAuthBar(document.getElementById('pe-auth-bar-mount'));
        loadProviders();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
      }
    });
  }

  async function loadProviders() {
    try {
      const res = await fetch(API_BASE + '?limit=10000');
      const data = await res.json();
      allProviders = Array.isArray(data) ? data : (data.providers || []);
    } catch {
      allProviders = [];
    }
  }

  function bindFlowEvents() {
    const searchInput = document.getElementById('claim-search-input');
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => searchProviders(searchInput.value.trim()), 300);
    });

    document.getElementById('claim-back-1').addEventListener('click', () => goToStep(1));
    document.getElementById('claim-back-2').addEventListener('click', () => goToStep(2));

    document.getElementById('claim-verify-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const role = document.getElementById('claim-verify-role').value;
      if (!role) return;

      // Enforce relevance statement when auto-verify isn't possible
      const relevanceEl = document.getElementById('claim-verify-relevance');
      const relevanceErr = document.getElementById('claim-relevance-error');
      if (relevanceErr) relevanceErr.style.display = 'none';
      if (relevanceRequired) {
        const val = (relevanceEl.value || '').trim();
        if (val.length < 30) {
          if (relevanceErr) relevanceErr.style.display = 'block';
          relevanceEl.focus();
          return;
        }
      }

      document.getElementById('claim-review-name').textContent = selectedProvider.name || selectedProvider.title || '';
      document.getElementById('claim-review-role').textContent = document.getElementById('claim-verify-role').selectedOptions[0].text;
      document.getElementById('claim-review-email').textContent = ProviderAuth.getUser()?.email || '';
      goToStep(3);
    });

    document.getElementById('claim-submit-btn').addEventListener('click', submitClaim);
  }

  function emailDomain(email) {
    if (!email) return '';
    const parts = String(email).trim().toLowerCase().split('@');
    return parts.length === 2 ? parts[1] : '';
  }

  function websiteDomain(url) {
    if (!url) return '';
    return String(url).trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '')
      .split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  }

  function domainsMatch(email, website) {
    const ed = emailDomain(email);
    const wd = websiteDomain(website);
    if (!ed || !wd) return false;
    if (ed === wd) return true;
    const rootOf = (d) => {
      const parts = d.split('.');
      if (parts.length < 2) return d;
      const secondLevelTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
      if (parts.length >= 3 && secondLevelTlds.has(parts[parts.length - 2])) return parts[parts.length - 3];
      return parts[parts.length - 2];
    };
    return rootOf(ed) === rootOf(wd);
  }

  function updateRelevanceGate() {
    const field = document.getElementById('claim-relevance-field');
    const help = document.getElementById('claim-relevance-help');
    const marker = document.getElementById('claim-relevance-required-marker');
    if (!field) return;

    const user = ProviderAuth.getUser();
    const email = user?.email || '';
    const website = selectedProvider ? (selectedProvider.website || '') : '';
    const ed = emailDomain(email);
    const isPersonal = ed && PERSONAL_EMAIL_DOMAINS.has(ed);

    // Auto-verifiable only when the account email matches the listed
    // website domain AND isn't a free/personal inbox.
    const autoVerified = website && domainsMatch(email, website) && !isPersonal;

    if (autoVerified) {
      relevanceRequired = false;
      field.hidden = true;
      return;
    }

    relevanceRequired = true;
    field.hidden = false;
    if (marker) marker.style.display = '';

    // Customize the helper text so the reason is transparent
    let reason;
    if (!website) {
      reason = "We don't have a website on file for this listing, so we can't automatically match your email. Please describe your Parkinson's relevance and your role.";
    } else if (isPersonal) {
      reason = "You're using a personal email address instead of your organization's domain. Please describe your Parkinson's relevance and your role so we can verify your claim.";
    } else {
      reason = "Your email domain doesn't match the website on this listing (" + website + "). Please describe your Parkinson's relevance and your role so we can verify your claim.";
    }
    if (help) help.textContent = reason;
  }

  function searchProviders(query) {
    const resultsWrap = document.getElementById('claim-search-results');
    const emptyWrap = document.getElementById('claim-search-empty');
    const list = document.getElementById('claim-search-list');
    const count = document.getElementById('claim-search-count');

    if (!query || query.length < 2) {
      resultsWrap.style.display = 'none';
      emptyWrap.style.display = 'none';
      return;
    }

    const q = query.toLowerCase();
    const matches = allProviders.filter(p => {
      const name = (p.name || p.title || '').toLowerCase();
      const loc = (p.location || p.city || '').toLowerCase();
      return name.includes(q) || loc.includes(q);
    }).slice(0, 10);

    if (matches.length === 0) {
      resultsWrap.style.display = 'none';
      emptyWrap.style.display = 'block';
      return;
    }

    emptyWrap.style.display = 'none';
    resultsWrap.style.display = 'block';
    count.textContent = matches.length + ' listing' + (matches.length !== 1 ? 's' : '') + ' found';

    list.innerHTML = matches.map(p => {
      const name = ProviderAuth.escapeHtml(p.name || p.title || 'Provider');
      const loc = ProviderAuth.escapeHtml(p.location || p.city || '');
      const initial = name.charAt(0).toUpperCase();
      return '<div style="display:flex;gap:1rem;align-items:center;padding:1rem;border-radius:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);cursor:pointer;" data-provider-id="' + ProviderAuth.escapeHtml(p.id || p.slug || '') + '">' +
        '<div class="exchange-provider-mark" style="width:48px;height:48px;font-size:1.1rem;">' + initial + '</div>' +
        '<div><strong style="color:var(--color-white);">' + name + '</strong>' +
        (loc ? '<br><span class="text-muted" style="font-size:0.88rem;">' + loc + '</span>' : '') +
        '</div></div>';
    }).join('');

    list.querySelectorAll('[data-provider-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-provider-id');
        const provider = allProviders.find(p => (p.id || p.slug) === id);
        if (provider) selectProvider(provider);
      });
    });
  }

  function selectProvider(provider) {
    selectedProvider = provider;
    const name = provider.name || provider.title || 'Provider';
    document.getElementById('claim-provider-mark').textContent = name.charAt(0).toUpperCase();
    document.getElementById('claim-provider-name').textContent = name;
    document.getElementById('claim-provider-meta').textContent = [provider.location || provider.city, provider.category || provider.type].filter(Boolean).join(' · ');
    updateRelevanceGate();
    goToStep(2);
  }

  function goToStep(step) {
    currentStep = step;
    [1, 2, 3].forEach(s => {
      const el = document.getElementById('claim-step-' + s);
      if (el) el.hidden = s !== step;
    });
    document.getElementById('claim-success').hidden = true;

    document.querySelectorAll('#claim-steps-bar .pe-flow-step').forEach(el => {
      const s = parseInt(el.dataset.step);
      el.className = 'pe-flow-step' + (s === step ? ' active' : s < step ? ' completed' : '');
    });
  }

  async function submitClaim() {
    const errorEl = document.getElementById('claim-submit-error');
    errorEl.style.display = 'none';
    const btn = document.getElementById('claim-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const payload = {
        providerId: selectedProvider.id || selectedProvider.slug,
        providerName: selectedProvider.name || selectedProvider.title,
        role: document.getElementById('claim-verify-role').value,
        phone: document.getElementById('claim-verify-phone').value.trim(),
      };
      const relevance = (document.getElementById('claim-verify-relevance').value || '').trim();
      if (relevance) payload.relevanceStatement = relevance;

      await ProviderAuth.apiCall('/provider/claim', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      document.querySelectorAll('#claim-steps-bar, #claim-step-1, #claim-step-2, #claim-step-3').forEach(el => el.hidden = true);
      document.getElementById('claim-success').hidden = false;
    } catch (err) {
      // Server enforces the same relevance-statement rule — if it 400s here
      // (e.g. client-side detection missed because the listing had no
      // website but we later fetched one), bounce back to step 2 with an
      // explanation instead of a raw error.
      const msg = err?.message || '';
      if (/RELEVANCE_STATEMENT_REQUIRED/i.test(msg) || /at least 30 characters/i.test(msg)) {
        relevanceRequired = true;
        const field = document.getElementById('claim-relevance-field');
        if (field) field.hidden = false;
        errorEl.textContent = 'Please add a short statement about your Parkinson\'s relevance and try again.';
        errorEl.style.display = 'block';
        goToStep(2);
        document.getElementById('claim-verify-relevance').focus();
      } else if (/DISPOSABLE_EMAIL/i.test(msg)) {
        errorEl.textContent = 'Please use a real business email address. Disposable/burner inboxes aren\'t accepted for provider claims.';
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Claim';
    }
  }
})();
