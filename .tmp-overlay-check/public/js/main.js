/* ============================================================
   DOING LIFE TODAY — main.js
   Mobile menu, smooth scroll, FAQ accordion, active nav, scroll-top
   ============================================================ */

(function () {
  'use strict';

  function ensureFavicon() {
    if (document.head.querySelector('link[rel="icon"]')) return;

    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = '/favicon.svg';
    document.head.appendChild(icon);
  }

  let logoGradientCount = 0;

  function buildLogoSvg(mark, text) {
    logoGradientCount += 1;
    const gradientId = 'dltGradNav' + logoGradientCount;

    return [
      '<svg class="nav-logo-svg" viewBox="0 0 240 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">',
      '  <defs>',
      `    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">`,
      '      <stop offset="0%" stop-color="#35D0FF"></stop>',
      '      <stop offset="50%" stop-color="#5B6CFF"></stop>',
      '      <stop offset="100%" stop-color="#C04BFF"></stop>',
      '    </linearGradient>',
      '  </defs>',
      `  <rect x="4" y="4" width="48" height="48" rx="12" fill="url(#${gradientId})"></rect>`,
      `  <text x="28" y="34" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="18" fill="white">${mark}</text>`,
      `  <text x="66" y="33" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="20" fill="white">${text}</text>`,
      '</svg>',
    ].join('');
  }

  function enhanceHeaderLogos() {
    document.querySelectorAll('.site-header .nav-logo').forEach((logoLink) => {
      const brandText = logoLink.dataset.logoText || 'Doing Life Today';
      const markText = logoLink.dataset.logoMark || 'DLT';

      logoLink.classList.add('nav-logo--enhanced');
      logoLink.innerHTML = buildLogoSvg(markText, brandText);
    });
  }

  function injectFooterTrustLinks() {
    const policyLinks = [
      { file: 'editorial-policy.html', label: 'Editorial Policy' },
      { file: 'medical-disclaimer.html', label: 'Medical Disclaimer' },
      { file: 'content-policy.html', label: 'Content Policy' },
    ];

    document.querySelectorAll('footer').forEach((footer) => {
      const legalList = Array.from(footer.querySelectorAll('.footer-links')).find((list) => {
        const anchors = Array.from(list.querySelectorAll('a'));
        return anchors.some((anchor) => /privacy\.html$/i.test(anchor.getAttribute('href') || '')) &&
          anchors.some((anchor) => /terms\.html$/i.test(anchor.getAttribute('href') || ''));
      });

      if (legalList) {
        const privacyLink = legalList.querySelector('a[href$="privacy.html"]');
        if (privacyLink) {
          const prefix = (privacyLink.getAttribute('href') || '').startsWith('../') ? '../' : '';
          let insertionPoint = privacyLink.closest('li');

          policyLinks.forEach((link) => {
            const href = prefix + link.file;
            if (legalList.querySelector(`a[href="${href}"]`)) return;

            const item = document.createElement('li');
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.textContent = link.label;
            item.appendChild(anchor);
            insertionPoint.insertAdjacentElement('beforebegin', item);
          });
        }
      }

      const legalParagraph = Array.from(footer.querySelectorAll('.footer-bottom p')).find((paragraph) => {
        return paragraph.querySelector('a[href$="privacy.html"]') && paragraph.querySelector('a[href$="terms.html"]');
      });

      if (legalParagraph) {
        const privacyLink = legalParagraph.querySelector('a[href$="privacy.html"]');
        const prefix = (privacyLink.getAttribute('href') || '').startsWith('../') ? '../' : '';

        policyLinks.slice().reverse().forEach((link) => {
          const href = prefix + link.file;
          if (legalParagraph.querySelector(`a[href="${href}"]`)) return;

          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.textContent = link.label;
          legalParagraph.insertBefore(document.createTextNode(' · '), privacyLink);
          legalParagraph.insertBefore(anchor, privacyLink);
        });
      }
    });
  }

  function injectFooterResourceLinks() {
    const priorityLinks = [
      { file: 'first-90-days-parkinsons.html', label: 'First 90 Days' },
      { file: 'mental-health.html', label: 'Mental Health' },
      { file: 'parkinsons-tremor.html', label: "Parkinson's Tremor" },
      { file: 'best-exercises-for-parkinsons.html', label: 'Best Exercises' },
      { file: 'clinical-trials.html', label: 'Clinical Trials' },
      { file: 'parkinsons-sleep.html', label: "Sleep and Parkinson's" },
    ];

    document.querySelectorAll('footer .footer-col').forEach((column) => {
      const heading = column.querySelector('h4');
      const list = column.querySelector('.footer-links');
      if (!heading || !list) return;
      if (heading.textContent.trim() !== "Parkinson's Resources") return;

      const links = Array.from(list.querySelectorAll('a'));
      const referenceLink = links[0];
      const prefix = referenceLink && (referenceLink.getAttribute('href') || '').startsWith('../') ? '../' : '';
      const firstItem = list.querySelector('li');

      priorityLinks.slice().reverse().forEach((link) => {
        const href = prefix + link.file;
        if (list.querySelector(`a[href="${href}"]`)) return;

        const item = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.textContent = link.label;
        item.appendChild(anchor);

        if (firstItem) {
          firstItem.insertAdjacentElement('beforebegin', item);
        } else {
          list.appendChild(item);
        }
      });
    });
  }

  function positionArticleAuthorBoxes() {
    document.querySelectorAll('.article-author-box-section').forEach((authorSection) => {
      const main = authorSection.closest('main');
      if (!main) return;

      main.querySelectorAll('.article-copyright').forEach((copyrightLine) => {
        copyrightLine.remove();
      });

      const faqHeading = main.querySelector('#faq');
      const faqSection = faqHeading && faqHeading.closest('section');

      const faqContainer = faqSection || Array.from(main.querySelectorAll('section')).find((section) => {
        return section.querySelector('.faq-accordion, .faq-list, .faq-item, #faq') ||
          /frequently asked questions/i.test(section.textContent || '');
      });

      const fallbackSection = Array.from(main.querySelectorAll('section')).find((section) => {
        return section.getAttribute('aria-label') === 'Article content';
      });

      const targetSection = faqContainer || fallbackSection;
      if (!targetSection || targetSection.nextElementSibling === authorSection) return;

      targetSection.insertAdjacentElement('afterend', authorSection);
    });
  }

  function initAutoYoutubeEmbeds() {
    const sections = document.querySelectorAll('[data-youtube-latest]');

    if (!sections.length) {
      return;
    }

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

    sections.forEach((section) => {
      const loadingEl = section.querySelector('[data-youtube-loading]');
      const dynamicEl = section.querySelector('[data-youtube-dynamic]');
      const fallbackEl = section.querySelector('[data-youtube-fallback]');
      const iframeEl = section.querySelector('[data-youtube-iframe]');
      const titleEl = section.querySelector('[data-youtube-title]');
      const dateEl = section.querySelector('[data-youtube-date]');
      const watchLinkEl = section.querySelector('[data-youtube-watch-link]');
      const playlistId = section.getAttribute('data-youtube-playlist');

      if (!iframeEl) {
        return;
      }

      const params = new URLSearchParams();
      if (playlistId) {
        params.set('playlistId', playlistId);
      }

      const endpoint = '/api/youtube/latest' + (params.toString() ? '?' + params.toString() : '');

      fetch(endpoint)
        .then((res) => {
          if (!res.ok) {
            throw new Error('API ' + res.status);
          }

          return res.json();
        })
        .then((data) => {
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
        .catch(() => {
          if (loadingEl) {
            loadingEl.style.display = 'none';
          }

          if (fallbackEl) {
            fallbackEl.style.display = 'block';
          }
        });
    });
  }

  ensureFavicon();
  enhanceHeaderLogos();
  injectFooterTrustLinks();
  injectFooterResourceLinks();
  positionArticleAuthorBoxes();
  initAutoYoutubeEmbeds();

  /* ── Mobile Menu ──────────────────────────────────────────── */
  const hamburger  = document.getElementById('hamburger');
  const mobileNav  = document.getElementById('mobile-nav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (
        mobileNav.classList.contains('open') &&
        !mobileNav.contains(e.target) &&
        !hamburger.contains(e.target)
      ) {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  /* ── Active Nav Highlighting ──────────────────────────────── */
  (function highlightNav() {
    const current = window.location.pathname.split('/').pop() || 'index.html';
    const currentAlias = current.endsWith('.html') ? current.slice(0, -5) : current;
    document.querySelectorAll('.nav-links a, .mobile-nav a').forEach(link => {
      const href = link.getAttribute('href');
      const hrefAlias = href && href.endsWith('.html') ? href.slice(0, -5) : href;
      if (href === current || hrefAlias === currentAlias || (current === '' && href === 'index.html')) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  })();

  /* ── Smooth Scroll for anchor links ──────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const navHeight = document.querySelector('.site-header')?.offsetHeight || 72;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 16;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* ── FAQ Accordion ────────────────────────────────────────── */
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-item.open').forEach(el => {
        el.classList.remove('open');
        el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });

      // Toggle clicked
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ── Scroll to Top Button ─────────────────────────────────── */
  const scrollTopBtn = document.getElementById('scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Category Filter (resources/events) ──────────────────── */
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.category-nav');
      group.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const spamProtection = (() => {
    const state = {
      configPromise: null,
      scriptPromise: null,
      forms: new WeakMap(),
    };

    function getFormState(form) {
      let formState = state.forms.get(form);
      if (!formState) {
        formState = {
          promise: null,
          widgetId: null,
          errorMessage: '',
          siteKey: '',
        };
        state.forms.set(form, formState);
      }
      return formState;
    }

    function ensureHoneypotField(form) {
      let honeypotInput = form.querySelector('[data-spam-honeypot-input="true"]');
      if (honeypotInput) {
        return honeypotInput;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'dlt-honeypot';
      wrapper.setAttribute('aria-hidden', 'true');

      const label = document.createElement('label');
      label.setAttribute('for', 'company-name-hidden-' + Math.random().toString(36).slice(2, 10));
      label.textContent = 'Leave this field empty';

      honeypotInput = document.createElement('input');
      honeypotInput.type = 'text';
      honeypotInput.name = 'company_name_hidden';
      honeypotInput.autocomplete = 'off';
      honeypotInput.tabIndex = -1;
      honeypotInput.setAttribute('data-spam-honeypot-input', 'true');
      honeypotInput.id = label.getAttribute('for');

      wrapper.append(label, honeypotInput);
      form.appendChild(wrapper);
      return honeypotInput;
    }

    function ensureRecaptchaContainer(form) {
      let container = form.querySelector('[data-recaptcha-slot="true"]');
      if (container) {
        return container;
      }

      container = document.createElement('div');
      container.className = 'dlt-recaptcha';
      container.setAttribute('data-recaptcha-slot', 'true');

      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitButton) {
        submitButton.insertAdjacentElement('beforebegin', container);
      } else {
        form.appendChild(container);
      }

      return container;
    }

    async function getPublicConfig() {
      if (!state.configPromise) {
        state.configPromise = fetch('/api/public-config', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error('Unable to load public form configuration.');
            }
            return response.json();
          })
          .catch(() => ({ recaptchaSiteKey: '' }));
      }

      return state.configPromise;
    }

    async function loadRecaptchaScript() {
      if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') {
        return new Promise((resolve, reject) => {
          try {
            window.grecaptcha.ready(() => {
              if (typeof window.grecaptcha.render === 'function') {
                resolve(window.grecaptcha);
                return;
              }

              reject(new Error('reCAPTCHA render is unavailable.'));
            });
          } catch (error) {
            reject(error);
          }
        });
      }

      if (!state.scriptPromise) {
        state.scriptPromise = new Promise((resolve, reject) => {
          const waitForRecaptcha = () => {
            const startedAt = Date.now();

            const poll = () => {
              if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') {
                try {
                  window.grecaptcha.ready(() => {
                    if (typeof window.grecaptcha.render === 'function') {
                      resolve(window.grecaptcha);
                      return;
                    }

                    reject(new Error('reCAPTCHA render is unavailable.'));
                  });
                } catch (error) {
                  reject(error);
                }
                return;
              }

              if ((Date.now() - startedAt) > 10000) {
                reject(new Error('Timed out waiting for reCAPTCHA to initialize.'));
                return;
              }

              window.setTimeout(poll, 50);
            };

            poll();
          };

          const existingScript = document.querySelector('script[data-dlt-recaptcha="true"]');
          if (existingScript) {
            if (window.grecaptcha) {
              waitForRecaptcha();
              return;
            }

            existingScript.addEventListener('load', waitForRecaptcha, { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Unable to load reCAPTCHA.')));
            return;
          }

          const script = document.createElement('script');
          script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
          script.async = true;
          script.defer = true;
          script.setAttribute('data-dlt-recaptcha', 'true');
          script.addEventListener('load', waitForRecaptcha, { once: true });
          script.addEventListener('error', () => reject(new Error('Unable to load reCAPTCHA.')));
          document.head.appendChild(script);
        });
      }

      return state.scriptPromise;
    }

    async function prepareForm(form) {
      const formState = getFormState(form);
      ensureHoneypotField(form);

      if (!formState.promise || (formState.errorMessage && typeof formState.widgetId !== 'number')) {
        formState.promise = (async () => {
          formState.errorMessage = '';
          const config = await getPublicConfig();
          formState.siteKey = ((config && config.recaptchaSiteKey) || '').trim();

          if (!formState.siteKey) {
            formState.errorMessage = 'Spam protection is currently unavailable. Please try again later.';
            return formState;
          }

          await loadRecaptchaScript();

          if (!window.grecaptcha || typeof window.grecaptcha.render !== 'function') {
            formState.errorMessage = 'Spam protection is currently unavailable. Please try again later.';
            return formState;
          }

          if (typeof formState.widgetId !== 'number') {
            const container = ensureRecaptchaContainer(form);
            formState.widgetId = window.grecaptcha.render(container, {
              sitekey: formState.siteKey,
              theme: 'dark',
            });
          }

          return formState;
        })().catch(() => {
          formState.errorMessage = 'Spam protection is currently unavailable. Please try again later.';
          formState.promise = null;
          return formState;
        });
      }

      return formState.promise;
    }

    async function collectSubmissionData(form) {
      const formState = await prepareForm(form);
      const honeypotInput = ensureHoneypotField(form);
      const honeypotValue = honeypotInput ? honeypotInput.value.trim() : '';

      if (honeypotValue) {
        return {
          honeypotValue,
          recaptchaToken: '',
          errorMessage: 'Submission rejected.',
        };
      }

      if (!window.grecaptcha || typeof formState.widgetId !== 'number') {
        return {
          honeypotValue,
          recaptchaToken: '',
          errorMessage: formState.errorMessage || 'Spam protection is currently unavailable. Please try again later.',
        };
      }

      const recaptchaToken = window.grecaptcha.getResponse(formState.widgetId);

      if (!recaptchaToken) {
        return {
          honeypotValue,
          recaptchaToken: '',
          errorMessage: 'Please complete the reCAPTCHA verification.',
        };
      }

      return {
        honeypotValue,
        recaptchaToken,
        errorMessage: '',
      };
    }

    function resetForm(form) {
      const formState = getFormState(form);
      const honeypotInput = form.querySelector('[data-spam-honeypot-input="true"]');
      if (honeypotInput) {
        honeypotInput.value = '';
      }

      if (window.grecaptcha && typeof formState.widgetId === 'number') {
        window.grecaptcha.reset(formState.widgetId);
      }
    }

    return {
      prepareForm,
      collectSubmissionData,
      resetForm,
    };
  })();

  window.dltSpamProtection = spamProtection;

  const emailCaptureForms = Array.from(document.querySelectorAll('form')).filter((form) => {
    if (form.id === 'contact-form' || form.id === 'waitlist-form' || form.id === 'stats-form') {
      return false;
    }

    if (form.querySelector('input[type="password"]')) {
      return false;
    }

    return !!form.querySelector('input[type="email"]')
      && !!form.querySelector('button[type="submit"], input[type="submit"]');
  });

  [document.getElementById('contact-form'), document.getElementById('waitlist-form'), ...emailCaptureForms]
    .filter(Boolean)
    .forEach((form) => {
      spamProtection.prepareForm(form).catch(() => {
        return null;
      });
    });

  /* ── Newsletter form ──────────────────────────────────────────── */
  emailCaptureForms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (!input || !input.value) return;

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Subscribing\u2026'; btn.disabled = true; }

      try {
        const protection = await spamProtection.collectSubmissionData(form);
        if (protection.errorMessage) {
          const msg = document.createElement('p');
          msg.textContent = '\u26a0\ufe0f ' + protection.errorMessage;
          msg.style.cssText = 'color:#FF6B35;font-weight:600;margin-top:0.75rem;';
          form.after(msg);
          if (btn) { btn.textContent = originalText; btn.disabled = false; }
          setTimeout(() => msg.remove(), 6000);
          return;
        }

        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: input.value,
            recaptchaToken: protection.recaptchaToken,
            company_name_hidden: protection.honeypotValue,
            source: window.location.pathname || '/'
          }),
        });
        const data = await res.json();
        const msg = document.createElement('p');
        if (res.ok) {
          msg.textContent = '🎉 ' + (data.message || 'Thanks for subscribing! Check your inbox.');
          msg.style.cssText = 'color:#20B2AA;font-weight:700;margin-top:0.75rem;';
          form.after(msg);
          form.style.display = 'none';
          setTimeout(() => {
            msg.remove();
            form.style.display = '';
            form.reset();
            spamProtection.resetForm(form);
            if (btn) { btn.textContent = originalText; btn.disabled = false; }
          }, 6000);
        } else {
          msg.textContent = '\u26a0\ufe0f ' + (data.error || 'Something went wrong. Please try again.');
          msg.style.cssText = 'color:#FF6B35;font-weight:600;margin-top:0.75rem;';
          form.after(msg);
          spamProtection.resetForm(form);
          if (btn) { btn.textContent = originalText; btn.disabled = false; }
          setTimeout(() => msg.remove(), 6000);
        }
      } catch {
        const msg = document.createElement('p');
        msg.textContent = '\u26a0\ufe0f Network error. Please try again.';
        msg.style.cssText = 'color:#FF6B35;font-weight:600;margin-top:0.75rem;';
        form.after(msg);
        spamProtection.resetForm(form);
        if (btn) { btn.textContent = originalText; btn.disabled = false; }
        setTimeout(() => msg.remove(), 6000);
      }
    });
  });

  /* ── Contact form ─────────────────────────────────────────── */
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn = contactForm.querySelector('button[type="submit"]');
      const originalText = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Sending\u2026'; btn.disabled = true; }

      const protection = await spamProtection.collectSubmissionData(contactForm);
      if (protection.errorMessage) {
        const msgEl = document.createElement('div');
        msgEl.innerHTML = '<p style="color:#FF6B35;font-weight:600;">\u26a0\ufe0f ' + protection.errorMessage + '</p>';
        msgEl.style.cssText = 'background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:12px;padding:1.5rem;text-align:center;margin-top:1.5rem;';
        contactForm.after(msgEl);
        if (btn) { btn.textContent = originalText; btn.disabled = false; }
        setTimeout(() => msgEl.remove(), 8000);
        return;
      }

      const payload = {
        name:         (contactForm.querySelector('[name="name"]')?.value || '').trim(),
        email:        (contactForm.querySelector('[name="email"]')?.value || '').trim(),
        organization: (contactForm.querySelector('[name="organization"]')?.value || '').trim(),
        inquiry_type: (contactForm.querySelector('[name="inquiry_type"]')?.value || '').trim(),
        message:      (contactForm.querySelector('[name="message"]')?.value || '').trim(),
        recaptchaToken: protection.recaptchaToken,
        company_name_hidden: protection.honeypotValue,
      };

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        const msgEl = document.createElement('div');
        if (res.ok) {
          msgEl.innerHTML = '<p style="color:#20B2AA;font-weight:700;font-size:1.1rem;">\u2705 ' + (data.message || "Message sent! We'll be in touch within 24\u201348 hours.") + '</p>';
          msgEl.style.cssText = 'background:rgba(32,178,170,0.1);border:1px solid rgba(32,178,170,0.3);border-radius:12px;padding:1.5rem;text-align:center;margin-top:1.5rem;';
          contactForm.after(msgEl);
          contactForm.style.display = 'none';
          spamProtection.resetForm(contactForm);
        } else {
          msgEl.innerHTML = '<p style="color:#FF6B35;font-weight:600;">\u26a0\ufe0f ' + (data.error || 'Something went wrong. Please try again or email office@dolifetoday.com.') + '</p>';
          msgEl.style.cssText = 'background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:12px;padding:1.5rem;text-align:center;margin-top:1.5rem;';
          contactForm.after(msgEl);
          spamProtection.resetForm(contactForm);
          if (btn) { btn.textContent = originalText; btn.disabled = false; }
          setTimeout(() => msgEl.remove(), 8000);
        }
      } catch {
        const msgEl = document.createElement('div');
        msgEl.innerHTML = '<p style="color:#FF6B35;font-weight:600;">\u26a0\ufe0f Network error. Please try again or email <a href="mailto:office@dolifetoday.com">office@dolifetoday.com</a>.</p>';
        msgEl.style.cssText = 'background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:12px;padding:1.5rem;text-align:center;margin-top:1.5rem;';
        contactForm.after(msgEl);
        spamProtection.resetForm(contactForm);
        if (btn) { btn.textContent = originalText; btn.disabled = false; }
        setTimeout(() => msgEl.remove(), 8000);
      }
    });
  }

  /* ── Intersection Observer: fade-in sections ──────────────── */
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('.card, .podcast-card, .event-card, .article-card, .product-card, .pricing-card, .testimonial-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });
  }

})();
