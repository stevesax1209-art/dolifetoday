(function () {
  'use strict';

  var STRIPE_LINKS = {
    verified: {
      monthly: 'https://buy.stripe.com/5kQ14h4yEeK47Nu0FN6Na01',
      yearly: 'https://buy.stripe.com/5kQ8wJd5a31m7Nu88f6Na02'
    },
    community: {
      monthly: 'https://buy.stripe.com/aFa4gtc16bxS9VC74b6Na03',
      yearly: 'https://buy.stripe.com/7sYfZb6GMeK49VC3RZ6Na04'
    }
  };

  var FALLBACK_LINKS = {
    verified: {
      monthly: '/contact?topic=verified-listing',
      yearly: '/contact?topic=verified-listing'
    },
    community: {
      monthly: '/contact?topic=community-provider',
      yearly: '/contact?topic=community-provider'
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

    return FALLBACK_LINKS[planName][period];
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

  if (!toggle) {
    return;
  }

  toggle.addEventListener('change', function () {
    applyPeriod(toggle.checked ? 'yearly' : 'monthly');
  });

  applyPeriod(currentPeriod);
})();