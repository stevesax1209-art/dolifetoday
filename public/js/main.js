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

  ensureFavicon();
  enhanceHeaderLogos();
  injectFooterTrustLinks();
  injectFooterResourceLinks();
  positionArticleAuthorBoxes();

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

  /* ── Newsletter form ──────────────────────────────────────────── */
  document.querySelectorAll('.newsletter-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (!input || !input.value) return;

      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Subscribing\u2026'; btn.disabled = true; }

      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: input.value }),
        });
        const data = await res.json();
        const msg = document.createElement('p');
        if (res.ok) {
          msg.textContent = '🎉 ' + (data.message || 'Thanks for subscribing! Check your inbox.');
          msg.style.cssText = 'color:#20B2AA;font-weight:700;margin-top:0.75rem;';
          form.after(msg);
          form.style.display = 'none';
          setTimeout(() => { msg.remove(); form.style.display = ''; form.reset(); if (btn) { btn.textContent = originalText; btn.disabled = false; } }, 6000);
        } else {
          msg.textContent = '\u26a0\ufe0f ' + (data.error || 'Something went wrong. Please try again.');
          msg.style.cssText = 'color:#FF6B35;font-weight:600;margin-top:0.75rem;';
          form.after(msg);
          if (btn) { btn.textContent = originalText; btn.disabled = false; }
          setTimeout(() => msg.remove(), 6000);
        }
      } catch {
        const msg = document.createElement('p');
        msg.textContent = '\u26a0\ufe0f Network error. Please try again.';
        msg.style.cssText = 'color:#FF6B35;font-weight:600;margin-top:0.75rem;';
        form.after(msg);
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

      const payload = {
        name:         (contactForm.querySelector('[name="name"]')?.value || '').trim(),
        email:        (contactForm.querySelector('[name="email"]')?.value || '').trim(),
        organization: (contactForm.querySelector('[name="organization"]')?.value || '').trim(),
        inquiry_type: (contactForm.querySelector('[name="inquiry_type"]')?.value || '').trim(),
        message:      (contactForm.querySelector('[name="message"]')?.value || '').trim(),
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
        } else {
          msgEl.innerHTML = '<p style="color:#FF6B35;font-weight:600;">\u26a0\ufe0f ' + (data.error || 'Something went wrong. Please try again or email office@dolifetoday.com.') + '</p>';
          msgEl.style.cssText = 'background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:12px;padding:1.5rem;text-align:center;margin-top:1.5rem;';
          contactForm.after(msgEl);
          if (btn) { btn.textContent = originalText; btn.disabled = false; }
          setTimeout(() => msgEl.remove(), 8000);
        }
      } catch {
        const msgEl = document.createElement('div');
        msgEl.innerHTML = '<p style="color:#FF6B35;font-weight:600;">\u26a0\ufe0f Network error. Please try again or email <a href="mailto:office@dolifetoday.com">office@dolifetoday.com</a>.</p>';
        msgEl.style.cssText = 'background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:12px;padding:1.5rem;text-align:center;margin-top:1.5rem;';
        contactForm.after(msgEl);
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
