# Doing Life Today — Content & Assets Checklist

This document lists **every item needed from you** to finish the site. Once you supply these, the site can be fully wired up and launched.

---

## 1. 🔗 Podcast Links

These replace the placeholder `href="#"` links throughout `podcasts.html`.

### Living with Parkinson's Podcast
| Item | What's needed |
|------|--------------|
| Spotify link | Full URL to the show on Spotify (e.g. `https://open.spotify.com/show/…`) |
| Apple Podcasts link | Full URL to the show on Apple Podcasts (e.g. `https://podcasts.apple.com/…`) |
| YouTube channel/playlist link | Full URL to the podcast playlist or channel |
| BuzzSprout link | Full URL to the BuzzSprout page (e.g. `https://www.buzzsprout.com/…`) |
| RSS feed URL | The raw RSS/podcast feed URL (for embedding a player or linking to Google Podcasts) |
| Episode archive page | URL to the full episode list, if hosted separately (e.g. BuzzSprout, your website, etc.) |

### Life in Motion Podcast
| Item | What's needed |
|------|--------------|
| Spotify link | Full URL to the show on Spotify |
| Apple Podcasts link | Full URL to the show on Apple Podcasts |
| YouTube channel/playlist link | Full URL |
| BuzzSprout link | Full URL |
| RSS feed URL | The raw RSS/podcast feed URL |

---

## 2. 📱 Social Media Links

Every page footer currently links to `https://youtube.com`, `https://instagram.com`, `https://tiktok.com`, and `https://facebook.com` — generic homepages. Please provide your actual profile URLs.

| Platform | What's needed |
|----------|--------------|
| YouTube | Your channel URL (e.g. `https://youtube.com/@dolifetoday`) |
| Instagram | Your profile URL (e.g. `https://instagram.com/dolifetoday`) |
| TikTok | Your profile URL (e.g. `https://tiktok.com/@dolifetoday`) |
| Facebook | Your page URL (e.g. `https://facebook.com/dolifetoday`) |

Also used in `store.html`: **`Follow @dolifetoday on Instagram ↗`** — confirm your Instagram handle is `@dolifetoday` or correct it.

---

## 3. 🎶 Music Platform Links (`music.html`)

Each playlist card has placeholder `href="#"` links. Please provide the real links for **each playlist** on each platform.

For every playlist listed (currently: Morning Movement, Evening Calm, Focus & Flow, Mood Lift, Gentle Stretching, Deep Rest, Power Hour), provide:

| Playlist Name | Spotify link | Apple Music link | YouTube link |
|---------------|-------------|-----------------|--------------|
| Morning Movement | | | |
| Evening Calm | | | |
| Focus & Flow | | | |
| Mood Lift | | | |
| Gentle Stretching | | | |
| Deep Rest | | | |
| Power Hour | | | |

> If you don't have separate Spotify/Apple/YouTube links yet, let us know and we can update the page to have a single "Listen" button per playlist.

---

## 4. 📱 PCN App Store Links (`pcn-app.html`)

| Item | What's needed |
|------|--------------|
| App Store (iOS) link | Full iTunes/App Store URL (e.g. `https://apps.apple.com/app/…`) |
| Google Play (Android) link | Full Google Play URL (e.g. `https://play.google.com/store/apps/details?id=…`) |

---

## 5. 🤝 Community Platform Link (`community.html`)

The **"Create Free Account"** button links to `href="#"`. Please provide:

| Item | What's needed |
|------|--------------|
| Community signup URL | The URL where people sign up (e.g. a Circle.so, Mighty Networks, Kajabi, or custom URL) |

---

## 6. 📅 Event Registration & Recording Links (`events.html`)

### Upcoming Events — Registration Links
| Event | Date | What's needed |
|-------|------|--------------|
| Understanding Deep Brain Stimulation — Live Q&A with Dr. Marcus Webb | May 15 | Registration link (e.g. Eventbrite, Zoom webinar, or your community platform) |
| DLT Chicago Meetup | Jun 1 | Registration link |
| Q2 Community Celebration | Jun 15 | Registration link |

> **Note:** Event dates currently say "May 2024" and "June 2024." If these are outdated, please provide updated dates for real upcoming events.

### Past Event Recordings
| Event | What's needed |
|-------|--------------|
| Spring Intensive Advocacy Bootcamp — Washington DC (Apr 2024) | Link to recap or recording |
| Expert Q&A: Exercise and Neuroprotection — Dr. Jill Fischer (Mar 2024) | Link to recording |
| Q1 Community Celebration: Year 6 Kickoff (Mar 2024) | Link to recording |
| Expert Q&A: Navigating Insurance and Access (Feb 2024) | Link to recording |

---

## 7. 📝 Form Submission Endpoints

The contact form and all newsletter/email signup forms are currently HTML-only and don't submit anywhere. Please advise on how you'd like these to work.

| Form | Location | What's needed |
|------|----------|--------------|
| Contact form | `contact.html` | A form submission endpoint (e.g. Formspree, Netlify Forms, your CRM, or a custom backend URL) |
| Homepage newsletter signup | `index.html` | Email service provider signup URL or API endpoint (e.g. Mailchimp, ConvertKit, ActiveCampaign) |
| Resources sidebar newsletter | `resources.html` | Same as above |
| Events email alert signup | `events.html` | Same as above |
| Store newsletter signup | `store.html` | Same as above |

---

## 8. 🖼️ Images & Media

No images are currently used on the site — all visuals are placeholder emoji or text. Please provide the following:

| Image | Where used | Notes |
|-------|-----------|-------|
| **DLT Logo** (full color + white versions) | All pages (nav, footer, social sharing) | SVG preferred; PNG fallback |
| **Favicon** | All pages `<head>` | `.ico` or `.png`, 32×32px |
| **Bryce Perry headshot** | `about.html` (currently shows "BP" text avatar) | High-res professional photo |
| **Living with Parkinson's Podcast cover art** | `podcasts.html`, social sharing | Standard 3000×3000px podcast artwork |
| **Life in Motion Podcast cover art** | `podcasts.html`, social sharing | Standard 3000×3000px podcast artwork |
| **PCN App screenshots** | `pcn-app.html` (feature showcase section) | 2–4 mobile screenshots |
| **Store product photos** | `store.html` (currently shows emoji placeholders for each product) | Photos for: Signature Tee, Advocacy Cap, Real Talk Mug, Community Hoodie, and any other products |
| **OG/social share image** | All pages (`og:image` meta tag) | 1200×630px banner image for link previews on Facebook, Twitter/X, etc. |
| **Hero or background image** (optional) | `index.html` hero section | Full-width background photo (community/lifestyle image) |
| **Bootcamp event photos** (optional) | `bootcamps.html` | Action shots from past bootcamp sessions |
| **Community/member photos** (optional) | `community.html` | Group or community event photos |

---

## 9. ✍️ Copy / Text Needed

| Location | What's missing |
|----------|---------------|
| `about.html` — Bryce Perry bio | Line reads `"A former [professional background]…"` — please fill in Bryce's background before DLT (e.g. former teacher, pastor, executive, etc.) |
| `about.html` — Timeline dates | Confirm the founding year and milestone dates are accurate (2018, 2019, 2020, etc.) |
| `events.html` — All upcoming event dates | Current dates say 2024 — update with real upcoming 2025/2026 event dates, times, and locations |
| `resources.html` — Article content | Articles are listed but have no full body text — confirm whether articles exist elsewhere to link to, or if you need them written |
| `podcasts.html` — Recent episodes | Episode titles, guest names, and air dates listed (Eps 124–127, 42–43) — confirm these are correct or provide the real recent episode list |
| `bootcamps.html` — Upcoming cohort dates | The page says "next cohort starts soon" — add the real next start date and enrollment deadline |
| `store.html` — Shipping & returns policy | Page mentions free shipping on orders over $50 — you need a full returns/shipping policy page (or at least the policy text) |
| All pages — Footer copyright year | Currently says © 2024 — update to © 2025 |

---

## 10. 🛒 Store / E-commerce Setup (`store.html`)

The store currently has product cards with "Add to Cart" buttons that do nothing. You have two options:

| Option | What's needed |
|--------|--------------|
| **A) Use a third-party print-on-demand / e-commerce platform** (recommended) | Link to your Shopify, WooCommerce, Spring/Teespring, or Printful store. We'll update all "Add to Cart" buttons to point there. |
| **B) Embed a third-party store widget** | Shopify Buy Button embed code, Gumroad embed, etc. |

Also needed for the store:
- Confirmed product list (names, descriptions, prices, sizes/variants)
- Product images (see Images section above)

---

## 11. 🔒 Additional Pages Needed

The following pages are linked or implied but don't exist yet:

| Page | Notes |
|------|-------|
| **Privacy Policy** | Required if you're collecting emails or any personal data |
| **Terms of Service** | Recommended for any paid products (store, bootcamps, Inner Circle) |
| **Accessibility Statement** | The site has strong accessibility features — an accessibility statement page is a good addition |

---

## Summary

| Category | # Items Needed |
|----------|---------------|
| Podcast links & feeds | 10 |
| Social media profile URLs | 4 |
| Music playlist links | Up to 21 |
| App Store links | 2 |
| Community platform URL | 1 |
| Event registration & recording links | 7 |
| Form endpoints (contact + newsletters) | 5 |
| Images & media | 8–12 |
| Copy/text corrections | 8 |
| Store/e-commerce setup | 1 decision + assets |
| Missing pages | 2–3 |

**Total: ~70–80 individual items.** Please work through this list and send us what you have — we can go section by section if that's easier. Items can be provided in any order and we'll integrate them as they come in.

---

*Last updated: March 2026*
