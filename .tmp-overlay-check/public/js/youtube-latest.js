(function () {
  'use strict';

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }

  function initYoutubeLatest() {
    var sections = document.querySelectorAll('[data-youtube-latest]');

    if (!sections.length) {
      return;
    }

    sections.forEach(function (section) {
      var loadingEl = section.querySelector('[data-youtube-loading]');
      var dynamicEl = section.querySelector('[data-youtube-dynamic]');
      var fallbackEl = section.querySelector('[data-youtube-fallback]');
      var iframeEl = section.querySelector('[data-youtube-iframe]');
      var titleEl = section.querySelector('[data-youtube-title]');
      var dateEl = section.querySelector('[data-youtube-date]');
      var watchLinkEl = section.querySelector('[data-youtube-watch-link]');
      var playlistId = section.getAttribute('data-youtube-playlist');

      if (!iframeEl) {
        return;
      }

      var params = new URLSearchParams();
      if (playlistId) {
        params.set('playlistId', playlistId);
      }

      var endpoint = '/api/youtube/latest';
      if (params.toString()) {
        endpoint += '?' + params.toString();
      }

      fetch(endpoint)
        .then(function (response) {
          if (!response.ok) {
            throw new Error('API ' + response.status);
          }

          return response.json();
        })
        .then(function (data) {
          iframeEl.src = 'https://www.youtube.com/embed/' + encodeURIComponent(data.videoId);

          if (titleEl) {
            titleEl.textContent = data.title || '';
          }

          if (dateEl) {
            dateEl.textContent = data.publishedAt ? formatDate(data.publishedAt) : '';
          }

          if (watchLinkEl && data.watchUrl) {
            watchLinkEl.href = data.watchUrl;
          }

          if (loadingEl) {
            loadingEl.style.display = 'none';
          }

          if (dynamicEl) {
            dynamicEl.style.display = 'block';
          }
        })
        .catch(function () {
          if (loadingEl) {
            loadingEl.style.display = 'none';
          }

          if (fallbackEl) {
            fallbackEl.style.display = 'block';
          }
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initYoutubeLatest, { once: true });
  } else {
    initYoutubeLatest();
  }
})();