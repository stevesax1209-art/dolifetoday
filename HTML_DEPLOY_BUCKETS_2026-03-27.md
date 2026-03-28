## DolifeToday HTML Buckets

Date: 2026-03-27

This file buckets the changed `public/*.html` files based on a local-vs-live audit plus targeted diff sampling.

### Already Live Match

These changed files currently match production exactly, so they are not the risky undeployed HTML delta:

- `public/exchange.html`
- `public/exchange-category.html`
- `public/exchange-claim.html`
- `public/exchange-location.html`
- `public/exchange-provider.html`
- `public/share-stats.html`

### Low-Risk Ship Candidates

These appear to be mostly mechanical route normalization, footer/nav updates, and character/encoding cleanup. They still differ from live, but targeted live-vs-local review did not show major content rewrites.

- `public/content-policy.html`
- `public/editorial-policy.html`
- `public/events.html`
- `public/lifeinmotion/index.html`
- `public/medical-disclaimer.html`
- `public/music.html`
- `public/privacy.html`
- `public/terms.html`

### Held Back On Purpose

These are not part of the current deploy-safe batch, even though some were previously bucketed as low risk.

- `public/bootcamps.html` — user explicitly wants this held back
- `public/store.html` — user explicitly wants this held back
- `public/podcast/index.html` — subdirectory/subdomain-oriented variant; current hosting redirects `/podcast` and `/podcast/**` to `/living-with-parkinsons-podcast`, so this is not the production-served page

### Needs Manual Review

These pages should be reviewed before deployment because they fall into at least one of these categories:

- major content or IA changes
- support-cluster or CTA restructuring
- new unpublished landing pages
- dynamic feature additions
- obvious typo or malformed-link regressions seen in sampled diffs

- `public/about.html`
- `public/best-exercises-for-parkinsons.html`
- `public/best-new-parkinsons-podcast.html`
- `public/best-parkinsons-podcast.html`
- `public/caregiver-burnout.html`
- `public/care-partners.html`
- `public/clinical-trials.html`
- `public/community.html`
- `public/community-support.html`
- `public/contact.html`
- `public/dbs-surgery.html`
- `public/dyskinesia.html`
- `public/early-signs-of-parkinsons.html`
- `public/exercise-movement.html`
- `public/first-90-days-parkinsons.html`
- `public/free-parkinsons-community.html`
- `public/freezing-of-gait.html`
- `public/hallucinations-delusions.html`
- `public/life-in-motion.html`
- `public/living-with-parkinsons.html`
- `public/living-with-parkinsons-podcast.html`
- `public/medication-treatment.html`
- `public/mental-health.html`
- `public/mental-health-parkinsons.html`
- `public/newly-diagnosed.html`
- `public/parkinsons-community.html`
- `public/parkinsons-constipation.html`
- `public/parkinsons-daily-check-in.html`
- `public/parkinsons-diet-nutrition.html`
- `public/parkinsons-exercise.html`
- `public/parkinsons-help-and-support.html`
- `public/parkinsons-medication-timing.html`
- `public/parkinsons-podcast-for-newly-diagnosed.html`
- `public/parkinsons-podcasts.html`
- `public/parkinsons-sleep.html`
- `public/parkinsons-support-group-online.html`
- `public/parkinsons-symptom-tracker.html`
- `public/parkinsons-tremor.html`
- `public/podcasts.html`
- `public/resources.html`
- `public/sleep-fatigue.html`
- `public/symptoms.html`
- `public/theclub.html`
- `public/theclub-confirmed.html`
- `public/theclub-next-steps.html`
- `public/voice-changes.html`
- `public/what-no-one-tells-you-after-parkinsons-diagnosis.html`
- `public/youtube.html`

### Notes

- The support/symptom pages are not just URL-normalization changes. Sampled diffs showed introduced text and href regressions like malformed paths and misspellings, so they should not be batch-deployed blindly.
- `public/theclub.html` is the biggest live delta by far and includes countdown, wave, share, and CTA logic changes. Treat it as its own review/deploy unit.
- `public/resources.html`, `public/parkinsons-community.html`, and `public/parkinsons-podcasts.html` are also major integration pages and should be reviewed as separate deploy units.
- `public/events.html`, `public/music.html`, and `public/lifeinmotion/index.html` were checked directly against live and look like safe cleanup candidates rather than major rewrites.
- `public/living-with-parkinsons-podcast.html` already contains the safe dynamic YouTube/latest-video implementation for the main site. `public/podcast/index.html` should be treated as a separate subdomain-oriented variant, not as a drop-in production replacement.
- Local Firebase Hosting smoke test passed for the current eight-file deploy-safe batch and its updated internal clean-URL targets on 2026-03-27.