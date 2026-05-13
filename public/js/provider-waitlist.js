(function () {
  'use strict';

  var CLOUD_FN_URL = 'https://joinproviderwaitlist-mynjsg4jwa-uc.a.run.app';

  var form = document.getElementById('pw-form');
  var successEl = document.getElementById('pw-success');
  var submitBtn = document.getElementById('pw-submit');
  var errorBox = document.getElementById('pw-form-error');

  if (!form) return;

  var fields = {
    name: { el: document.getElementById('pw-name'), error: document.getElementById('pw-name-error'), validate: function (v) { return v.trim().length >= 2; } },
    email: { el: document.getElementById('pw-email'), error: document.getElementById('pw-email-error'), validate: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); } },
    providerName: { el: document.getElementById('pw-provider-name'), error: document.getElementById('pw-provider-name-error'), validate: function (v) { return v.trim().length >= 2; } },
    location: { el: document.getElementById('pw-location'), error: document.getElementById('pw-location-error'), validate: function (v) { return v.trim().length >= 2; } },
    category: { el: document.getElementById('pw-category'), error: document.getElementById('pw-category-error'), validate: function (v) { return v !== ''; } }
  };

  function clearErrors() {
    Object.keys(fields).forEach(function (key) {
      if (fields[key].error) fields[key].error.style.display = 'none';
      if (fields[key].el) fields[key].el.style.borderColor = '';
    });
    if (errorBox) errorBox.style.display = 'none';
  }

  function validateAll() {
    var valid = true;
    Object.keys(fields).forEach(function (key) {
      var f = fields[key];
      if (!f.el) return;
      if (!f.validate(f.el.value)) {
        valid = false;
        if (f.error) f.error.style.display = 'block';
        f.el.style.borderColor = 'rgba(239,68,68,0.5)';
      }
    });
    return valid;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();

    if (!validateAll()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    var payload = {
      name: fields.name.el.value.trim(),
      email: fields.email.el.value.trim(),
      providerName: fields.providerName.el.value.trim(),
      location: fields.location.el.value.trim(),
      category: fields.category.el.value,
      website: (document.getElementById('pw-website') || {}).value || ''
    };

    fetch(CLOUD_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Something went wrong'); });
        return res.json();
      })
      .then(function () {
        form.hidden = true;
        if (successEl) successEl.hidden = false;
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Join Provider Waitlist';
        if (errorBox) {
          errorBox.textContent = err.message || 'Something went wrong. Please try again.';
          errorBox.style.display = 'block';
        }
      });
  });
})();
