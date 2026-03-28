/* ============================================================
   CREATE LISTING — Client-side logic
   Multi-step form to create a new provider listing
   ============================================================ */

(function () {
  'use strict';

  let authMode = 'signup';
  let currentStep = 1;
  let basicData = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (ProviderAuth.isAuthenticated()) {
      showFlowView();
      ProviderAuth.renderAuthBar(document.getElementById('pe-auth-bar-mount'));
    } else {
      showAuthView();
    }

    bindAuthForm();
    bindFlowEvents();
  }

  function showAuthView() {
    document.getElementById('create-auth-view').hidden = false;
    document.getElementById('create-flow-view').hidden = true;
  }

  function showFlowView() {
    document.getElementById('create-auth-view').hidden = true;
    document.getElementById('create-flow-view').hidden = false;
  }

  function setAuthMode(mode) {
    authMode = mode;
    const nameField = document.getElementById('create-name-field');
    const submitBtn = document.getElementById('create-auth-submit');
    const signinTab = document.getElementById('create-tab-signin');
    const signupTab = document.getElementById('create-tab-signup');

    if (mode === 'signup') {
      nameField.hidden = false;
      submitBtn.textContent = 'Create Account';
      signinTab.className = 'btn btn-outline-primary btn-sm';
      signupTab.className = 'btn btn-primary btn-sm';
    } else {
      nameField.hidden = true;
      submitBtn.textContent = 'Sign In';
      signinTab.className = 'btn btn-primary btn-sm';
      signupTab.className = 'btn btn-outline-primary btn-sm';
    }
  }

  function bindAuthForm() {
    document.getElementById('create-tab-signin').addEventListener('click', () => setAuthMode('signin'));
    document.getElementById('create-tab-signup').addEventListener('click', () => setAuthMode('signup'));

    document.getElementById('create-auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('create-auth-error');
      errorEl.style.display = 'none';

      const email = document.getElementById('create-auth-email').value.trim();
      const password = document.getElementById('create-auth-password').value;
      const name = document.getElementById('create-auth-name').value.trim();

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

      const submitBtn = document.getElementById('create-auth-submit');
      submitBtn.disabled = true;

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
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function bindFlowEvents() {
    document.getElementById('create-basic-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('create-name').value.trim();
      const category = document.getElementById('create-category').value;
      const format = document.getElementById('create-format').value;
      const city = document.getElementById('create-city').value.trim();
      const country = document.getElementById('create-country').value.trim();

      if (!name || !category || !format || !city || !country) return;

      basicData = {
        name, category, format, city,
        state: document.getElementById('create-state').value.trim(),
        country,
      };
      goToStep(2);
    });

    document.getElementById('create-details-form').addEventListener('submit', (e) => {
      e.preventDefault();
      basicData.description = document.getElementById('create-description').value.trim();
      basicData.website = document.getElementById('create-website').value.trim();
      basicData.phone = document.getElementById('create-phone').value.trim();
      basicData.contactEmail = document.getElementById('create-email-contact').value.trim();
      basicData.language = document.getElementById('create-language').value.trim();
      basicData.tags = document.getElementById('create-tags').value.trim();

      renderReviewSummary();
      goToStep(3);
    });

    document.getElementById('create-back-1').addEventListener('click', () => goToStep(1));
    document.getElementById('create-back-2').addEventListener('click', () => goToStep(2));
    document.getElementById('create-submit-btn').addEventListener('click', submitListing);
  }

  function goToStep(step) {
    currentStep = step;
    [1, 2, 3].forEach(s => {
      const el = document.getElementById('create-step-' + s);
      if (el) el.hidden = s !== step;
    });
    document.getElementById('create-success').hidden = true;

    document.querySelectorAll('#create-steps-bar .pe-flow-step').forEach(el => {
      const s = parseInt(el.dataset.step);
      el.className = 'pe-flow-step' + (s === step ? ' active' : s < step ? ' completed' : '');
    });
  }

  function renderReviewSummary() {
    const summary = document.getElementById('create-review-summary');
    const fields = [
      ['Name', basicData.name],
      ['Category', basicData.category],
      ['Service Mode', basicData.format],
      ['Location', [basicData.city, basicData.state, basicData.country].filter(Boolean).join(', ')],
      ['Description', basicData.description || '—'],
      ['Website', basicData.website || '—'],
      ['Phone', basicData.phone || '—'],
      ['Language', basicData.language || '—'],
      ['Tags', basicData.tags || '—'],
    ];
    summary.innerHTML = fields.map(([label, value]) =>
      '<p><strong>' + ProviderAuth.escapeHtml(label) + ':</strong> ' + ProviderAuth.escapeHtml(value) + '</p>'
    ).join('');
  }

  async function submitListing() {
    const errorEl = document.getElementById('create-submit-error');
    errorEl.style.display = 'none';
    const btn = document.getElementById('create-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      await ProviderAuth.apiCall('/provider/create', {
        method: 'POST',
        body: JSON.stringify(basicData),
      });

      document.querySelectorAll('#create-steps-bar, #create-step-1, #create-step-2, #create-step-3').forEach(el => el.hidden = true);
      document.getElementById('create-success').hidden = false;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Listing';
    }
  }
})();
