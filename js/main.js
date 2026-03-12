/* ============================================================
   DOING LIFE TODAY — main.js
   Mobile menu, smooth scroll, FAQ accordion, active nav, scroll-top
   ============================================================ */

(function () {
  'use strict';

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
    document.querySelectorAll('.nav-links a, .mobile-nav a').forEach(link => {
      const href = link.getAttribute('href');
      if (href === current || (current === '' && href === 'index.html')) {
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
        const res = await fetch('/.netlify/functions/subscribe', {
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
        const res = await fetch('/.netlify/functions/contact', {
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
