(function () {
  'use strict';

  var STRIPE_LINKS = {
    verified: {
      monthly: 'https://buy.stripe.com/5kQ14h4yEeK47Nu0FN6Na01',
      yearly: 'https://buy.stripe.com/5kQ8wJd5a31m7Nu88f6Na02'
    }
  };

  var FALLBACK_LINKS = {
    verified: {
      monthly: '/contact?topic=verified-listing',
      yearly: '/contact?topic=verified-listing'
    }
  };

  var toggle = document.getElementById('exchange-provider-billing-period');
  var labels = document.querySelectorAll('[data-billing-label]');
  var saveBadge = document.querySelector('[data-save-badge]');
  var planCards = document.querySelectorAll('[data-plan-card]');
  var currentPeriod = 'monthly';

  function getPlanUrl(planName, period) {
    if (STRIPE_LINKS[planName] && STRIPE_LINKS[planName][period]) {
      return STRIPE_LINKS[planName][period];
    }

    return (FALLBACK_LINKS[planName] && FALLBACK_LINKS[planName][period]) || '/contact';
  }

  function updateLabels(period) {
    labels.forEach(function (labelNode) {
      var isActive = labelNode.getAttribute('data-billing-label') === period;
      labelNode.classList.toggle('exchange-provider-billing-label-active', isActive);
    });

    if (saveBadge) {
      saveBadge.hidden = period !== 'yearly';
    }
  }

  function updatePlanCard(cardNode, period) {
    var planName = cardNode.getAttribute('data-plan');
    var priceValueNode = cardNode.querySelector('[data-price-value]');
    var priceSuffixNode = cardNode.querySelector('[data-price-suffix]');
    var planLinkNode = cardNode.querySelector('[data-plan-link]');

    if (!planName || !priceValueNode || !priceSuffixNode || !planLinkNode) {
      return;
    }

    var price = period === 'yearly'
      ? cardNode.getAttribute('data-yearly-price')
      : cardNode.getAttribute('data-monthly-price');
    var suffix = period === 'yearly'
      ? cardNode.getAttribute('data-yearly-suffix')
      : cardNode.getAttribute('data-monthly-suffix');

    priceValueNode.textContent = '$' + price;
    priceSuffixNode.textContent = suffix;
    planLinkNode.setAttribute('href', getPlanUrl(planName, period));
  }

  function applyPeriod(period) {
    currentPeriod = period;
    updateLabels(period);
    planCards.forEach(function (cardNode) {
      updatePlanCard(cardNode, period);
    });
  }

  if (toggle) {
    toggle.addEventListener('change', function () {
      applyPeriod(toggle.checked ? 'yearly' : 'monthly');
    });
    applyPeriod(currentPeriod);
  }

  /* ─── WAVE COUNTDOWN TIMER ─────────────────────────── */

  // Wave config — change these to control waves
  var WAVE_SIZE = 10;
  var WAVE_INTERVAL_DAYS = 14;

  // Calculate next wave date: every 14 days starting from FIRST_WAVE_DATE
  // Set this to the first wave opening date
  var FIRST_WAVE_DATE = new Date('2026-04-25T12:00:00-05:00');

  function getNextWaveDate() {
    var now = new Date();
    var target = new Date(FIRST_WAVE_DATE.getTime());

    while (target <= now) {
      target = new Date(target.getTime() + WAVE_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    }
    return target;
  }

  var daysEl = document.getElementById('wave-days');
  var hoursEl = document.getElementById('wave-hours');
  var minutesEl = document.getElementById('wave-minutes');
  var secondsEl = document.getElementById('wave-seconds');

  if (daysEl && hoursEl && minutesEl && secondsEl) {
    var nextWave = getNextWaveDate();

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function updateCountdown() {
      var now = Date.now();
      var diff = nextWave.getTime() - now;

      if (diff <= 0) {
        // Wave just opened — recalculate next one
        nextWave = getNextWaveDate();
        diff = nextWave.getTime() - now;
      }

      var totalSec = Math.floor(diff / 1000);
      var d = Math.floor(totalSec / 86400);
      var h = Math.floor((totalSec % 86400) / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;

      daysEl.textContent = pad(d);
      hoursEl.textContent = pad(h);
      minutesEl.textContent = pad(m);
      secondsEl.textContent = pad(s);
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  /* ─── SPOTS COUNTER ────────────────────────────────── */

  var spotsFill = document.getElementById('wave-spots-fill');
  var spotsRemaining = document.getElementById('wave-spots-remaining');
  var spotsTotal = document.getElementById('wave-spots-total');
  var urgencyMsg = document.getElementById('wave-urgency-msg');

  function updateSpots(remaining, total) {
    if (!spotsFill || !spotsRemaining || !spotsTotal) return;

    var t = total || WAVE_SIZE;
    var r = Math.max(0, Math.min(t, remaining));

    spotsTotal.textContent = String(t);
    spotsRemaining.textContent = String(r);
    spotsFill.style.width = ((r / t) * 100) + '%';

    if (urgencyMsg) {
      urgencyMsg.hidden = r > 3;
    }
  }

  // Initialize with full spots (will be replaced with Firestore data when admin panel is built)
  updateSpots(WAVE_SIZE, WAVE_SIZE);

  // Expose for external use (admin updates, etc.)
  window.__waveUpdateSpots = updateSpots;
})();