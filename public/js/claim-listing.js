/* ============================================================
   CLAIM LISTING — Client-side logic
   Search for existing providers, verify, and submit claim
   ============================================================ */

(function () {
  'use strict';

  const API_BASE = 'https://club.dolifetoday.com/api/exchange/providers';
  let allProviders = [];
  let selectedProvider = null;
  let authMode = 'signin';
  let currentStep = 1;

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

      document.getElementById('claim-review-name').textContent = selectedProvider.name || selectedProvider.title || '';
      document.getElementById('claim-review-role').textContent = document.getElementById('claim-verify-role').selectedOptions[0].text;
      document.getElementById('claim-review-email').textContent = ProviderAuth.getUser()?.email || '';
      goToStep(3);
    });

    document.getElementById('claim-submit-btn').addEventListener('click', submitClaim);
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
      await ProviderAuth.apiCall('/provider/claim', {
        method: 'POST',
        body: JSON.stringify({
          providerId: selectedProvider.id || selectedProvider.slug,
          providerName: selectedProvider.name || selectedProvider.title,
          role: document.getElementById('claim-verify-role').value,
          phone: document.getElementById('claim-verify-phone').value.trim(),
        }),
      });

      document.querySelectorAll('#claim-steps-bar, #claim-step-1, #claim-step-2, #claim-step-3').forEach(el => el.hidden = true);
      document.getElementById('claim-success').hidden = false;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Claim';
    }
  }
})();
