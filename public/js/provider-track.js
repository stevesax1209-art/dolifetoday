/* ============================================================
   PROVIDER ANALYTICS — Lightweight event tracking
   Logs behavioral events to /api/track-provider-event
   ============================================================ */

(function () {
  'use strict';

  window.ProviderTrack = {
    track: function (eventName, payload) {
      if (!eventName) return;
      var body = Object.assign({ eventName: eventName }, payload || {});

      // Attempt to include tier from ProviderAuth session if available
      try {
        var session = JSON.parse(sessionStorage.getItem('pe_session') || '{}');
        if (session.tier) body.tier = session.tier;
      } catch (_) { /* ignore */ }

      var token = '';
      try { token = sessionStorage.getItem('pe_token') || ''; } catch (_) { /* ignore */ }

      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      fetch('/api/track-provider-event', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      }).catch(function () { /* fire-and-forget */ });
    }
  };
})();
