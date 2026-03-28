(function () {
  'use strict';

  var statBlocks = document.querySelectorAll('[data-about-stat]');

  if (!statBlocks.length) {
    return;
  }

  function formatCompactNumber(value) {
    var numericValue = Number(value || 0);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return '';
    }

    if (numericValue >= 1000000) {
      return (numericValue / 1000000).toFixed(numericValue >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M+';
    }

    if (numericValue >= 1000) {
      return (numericValue / 1000).toFixed(numericValue >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K+';
    }

    return String(numericValue) + '+';
  }

  function updateBlock(block, value, label) {
    var valueEl = block.querySelector('.num');
    var labelEl = block.querySelector('.label');

    if (valueEl && value) {
      valueEl.textContent = value;
    }

    if (labelEl && label) {
      labelEl.textContent = label;
    }
  }

  function applyFallbacks() {
    statBlocks.forEach(function (block) {
      updateBlock(
        block,
        block.getAttribute('data-fallback-value') || '',
        block.getAttribute('data-fallback-label') || ''
      );
    });
  }

  applyFallbacks();

  fetch('/api/youtube/latest')
    .then(function (response) {
      if (!response.ok) {
        throw new Error('API ' + response.status);
      }

      return response.json();
    })
    .then(function (data) {
      statBlocks.forEach(function (block) {
        var statType = block.getAttribute('data-about-stat');

        if (statType === 'subscribers') {
          updateBlock(block, formatCompactNumber(data.subscriberCount), 'YouTube subscribers');
          return;
        }

        if (statType === 'videos') {
          updateBlock(block, formatCompactNumber(data.videoCount), 'Videos published');
          return;
        }

        if (statType === 'views') {
          updateBlock(block, formatCompactNumber(data.viewCount), 'YouTube channel views');
        }
      });
    })
    .catch(function () {
      return null;
    });
})();
