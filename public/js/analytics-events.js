/* ============================================================
   ENHANCED ANALYTICS — Custom event tracking for GA4
   Tracks: scroll depth, CTA clicks, outbound links,
   video engagement, form submissions, file downloads
   ============================================================ */

(function () {
  'use strict';

  if (typeof gtag !== 'function') return;

  /* ── Scroll Depth ──────────────────────────────────────── */
  var scrollMarks = { 25: false, 50: false, 75: false, 100: false };

  function getScrollPercent() {
    var h = document.documentElement;
    var b = document.body;
    var st = h.scrollTop || b.scrollTop;
    var sh = (h.scrollHeight || b.scrollHeight) - h.clientHeight;
    if (sh <= 0) return 100;
    return Math.round((st / sh) * 100);
  }

  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      var pct = getScrollPercent();
      var keys = [25, 50, 75, 100];
      for (var i = 0; i < keys.length; i++) {
        if (pct >= keys[i] && !scrollMarks[keys[i]]) {
          scrollMarks[keys[i]] = true;
          gtag('event', 'scroll_depth', {
            percent_scrolled: keys[i],
            page_path: location.pathname
          });
        }
      }
    }, 200);
  }, { passive: true });

  /* ── CTA / Button Clicks ───────────────────────────────── */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a, button');
    if (!el) return;

    var href = el.getAttribute('href') || '';
    var text = (el.textContent || '').trim().substring(0, 80);
    var classes = el.className || '';

    // File downloads
    if (/\.(pdf|doc|docx|xls|xlsx|csv|zip|ics)(\?|$)/i.test(href)) {
      gtag('event', 'file_download', {
        file_name: href.split('/').pop().split('?')[0],
        link_url: href,
        page_path: location.pathname
      });
      return;
    }

    // Outbound links
    if (el.tagName === 'A' && href && /^https?:\/\//i.test(href)) {
      try {
        var linkHost = new URL(href).hostname;
        if (linkHost !== location.hostname && linkHost !== 'dolifetoday.com' && linkHost !== 'www.dolifetoday.com') {
          gtag('event', 'outbound_click', {
            link_url: href,
            link_text: text,
            link_domain: linkHost,
            page_path: location.pathname
          });
          return;
        }
      } catch (_) { /* invalid URL */ }
    }

    // CTA buttons
    if (/\bbtn\b|card-cta|nav-cta/.test(classes)) {
      gtag('event', 'cta_click', {
        cta_text: text,
        cta_url: href || null,
        cta_class: classes.substring(0, 100),
        page_path: location.pathname
      });
    }
  });

  /* ── Form Submissions ─────────────────────────────────── */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var id = form.id || form.getAttribute('name') || 'unknown';
    var action = form.getAttribute('action') || location.pathname;
    gtag('event', 'form_submit', {
      form_id: id,
      form_action: action,
      page_path: location.pathname
    });
  });

  /* ── YouTube Video Engagement ─────────────────────────── */
  function trackYouTubeVideos() {
    var iframes = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]');
    if (!iframes.length) return;

    // Enable JS API on existing iframes
    for (var i = 0; i < iframes.length; i++) {
      var src = iframes[i].src;
      if (src.indexOf('enablejsapi') === -1) {
        iframes[i].src = src + (src.indexOf('?') === -1 ? '?' : '&') + 'enablejsapi=1';
      }
    }

    // Load YouTube IFrame API if not present
    if (!window.YT || !window.YT.Player) {
      var tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    function bindPlayers() {
      var frames = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]');
      for (var j = 0; j < frames.length; j++) {
        if (frames[j].dataset.ytBound) continue;
        frames[j].dataset.ytBound = '1';
        try {
          new YT.Player(frames[j], {
            events: {
              onStateChange: function (event) {
                var states = { 1: 'play', 2: 'pause', 0: 'complete' };
                var state = states[event.data];
                if (state) {
                  var videoUrl = '';
                  try { videoUrl = event.target.getVideoUrl(); } catch (_) {}
                  gtag('event', 'video_' + state, {
                    video_url: videoUrl,
                    video_provider: 'youtube',
                    page_path: location.pathname
                  });
                }
              }
            }
          });
        } catch (_) { /* frame not ready */ }
      }
    }

    if (window.YT && window.YT.Player) {
      bindPlayers();
    } else {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        bindPlayers();
      };
    }
  }

  // Delay video tracking to not block page load
  if (document.readyState === 'complete') {
    setTimeout(trackYouTubeVideos, 1000);
  } else {
    window.addEventListener('load', function () {
      setTimeout(trackYouTubeVideos, 1000);
    });
  }

  /* ── Engagement Time ──────────────────────────────────── */
  var engagementMarks = { 30: false, 60: false, 120: false, 300: false };
  var pageStart = Date.now();
  var engagementInterval = setInterval(function () {
    var elapsed = Math.floor((Date.now() - pageStart) / 1000);
    var keys = [30, 60, 120, 300];
    for (var i = 0; i < keys.length; i++) {
      if (elapsed >= keys[i] && !engagementMarks[keys[i]]) {
        engagementMarks[keys[i]] = true;
        gtag('event', 'engagement_time', {
          seconds: keys[i],
          page_path: location.pathname
        });
      }
    }
    if (engagementMarks[300]) clearInterval(engagementInterval);
  }, 5000);

  // Stop tracking when tab is hidden
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      pageStart += (Date.now() - pageStart); // freeze the timer
    }
  });

})();
