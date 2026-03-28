/* ============================================================
   PROVIDER AUTH — Shared authentication module
   Firebase Auth for provider accounts
   ============================================================ */

(function () {
  'use strict';

  const API_BASE = '/api';

  const ProviderAuth = {
    _token: null,
    _user: null,

    async getToken() {
      const stored = sessionStorage.getItem('pe_token');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.expiresAt > Date.now()) {
            this._token = parsed.token;
            this._user = parsed.user;
            return parsed.token;
          }
        } catch { /* expired or invalid */ }
        sessionStorage.removeItem('pe_token');
      }
      return null;
    },

    getUser() {
      if (this._user) return this._user;
      try {
        const stored = sessionStorage.getItem('pe_token');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.expiresAt > Date.now()) {
            this._user = parsed.user;
            return parsed.user;
          }
        }
      } catch { /* ignore */ }
      return null;
    },

    setSession(token, user, expiresInMs) {
      const session = {
        token,
        user,
        expiresAt: Date.now() + (expiresInMs || 3600000),
      };
      this._token = token;
      this._user = user;
      sessionStorage.setItem('pe_token', JSON.stringify(session));
    },

    clearSession() {
      this._token = null;
      this._user = null;
      sessionStorage.removeItem('pe_token');
    },

    async signUp(email, password, name) {
      const res = await fetch(API_BASE + '/provider/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign up failed');
      this.setSession(data.token, data.user, data.expiresIn);
      return data;
    },

    async signIn(email, password) {
      const res = await fetch(API_BASE + '/provider/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign in failed');
      this.setSession(data.token, data.user, data.expiresIn);
      return data;
    },

    signOut() {
      this.clearSession();
      window.location.href = '/exchange';
    },

    async apiCall(endpoint, options) {
      const token = await this.getToken();
      if (!token) {
        window.location.href = '/claim-listing?auth=signin';
        throw new Error('Not authenticated');
      }
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(options?.headers || {}),
      };
      const res = await fetch(API_BASE + endpoint, { ...options, headers });
      if (res.status === 401) {
        this.clearSession();
        window.location.href = '/claim-listing?auth=signin';
        throw new Error('Session expired');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    },

    isAuthenticated() {
      return !!this.getUser();
    },

    requireAuth(redirectTo) {
      if (!this.isAuthenticated()) {
        const dest = redirectTo || window.location.pathname;
        window.location.href = '/claim-listing?auth=signin&redirect=' + encodeURIComponent(dest);
        return false;
      }
      return true;
    },

    renderAuthBar(container) {
      const user = this.getUser();
      if (!user || !container) return;
      container.innerHTML =
        '<div class="pe-auth-bar">' +
          '<span class="pe-auth-bar-user">👤 ' + this.escapeHtml(user.name || user.email) + '</span>' +
          '<div class="pe-auth-bar-actions">' +
            '<a href="/provider-dashboard" class="btn btn-outline-primary btn-sm">Dashboard</a>' +
            '<button id="pe-signout-btn" class="btn btn-outline-primary btn-sm">Sign Out</button>' +
          '</div>' +
        '</div>';
      const btn = document.getElementById('pe-signout-btn');
      if (btn) btn.addEventListener('click', () => this.signOut());
    },

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },
  };

  window.ProviderAuth = ProviderAuth;
})();
