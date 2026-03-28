# DolifeToday Deploy-Safe Batch

Date: 2026-03-27

This file defines the current deploy-safe HTML batch based on the live-vs-local audit completed on 2026-03-27.

## Approved Files

These files are currently modified in the working tree and approved for a low-risk deploy batch:

- `public/content-policy.html`
- `public/editorial-policy.html`
- `public/events.html`
- `public/lifeinmotion/index.html`
- `public/medical-disclaimer.html`
- `public/music.html`
- `public/privacy.html`
- `public/terms.html`

## Why These Are In Scope

- They differ from live, but review indicates low-risk changes only.
- The main pattern is route normalization, footer/nav cleanup, and character/encoding cleanup.
- `public/events.html`, `public/music.html`, and `public/lifeinmotion/index.html` were checked directly against live and did not show major content or behavior rewrites.
- None of these files are part of the held-back `store`, `bootcamps`, or `podcast/index` paths.

## Explicitly Out Of Scope

Do not include these in this batch:

- `public/bootcamps.html`
- `public/store.html`
- `public/podcast/index.html`
- anything in the manual-review bucket from `HTML_DEPLOY_BUCKETS_2026-03-27.md`

## Current Git Status

All approved files are currently modified:

- `M public/content-policy.html`
- `M public/editorial-policy.html`
- `M public/events.html`
- `M public/lifeinmotion/index.html`
- `M public/medical-disclaimer.html`
- `M public/music.html`
- `M public/privacy.html`
- `M public/terms.html`

## Recommended Batch Boundary

If preparing a commit or deploy artifact, keep this batch limited to the eight approved HTML files above.

## Verification Completed

- VS Code diagnostics reported no errors in the eight approved files.
- Local Firebase Hosting smoke test passed for the staged routes:
	- `/content-policy`
	- `/editorial-policy`
	- `/events`
	- `/lifeinmotion`
	- `/medical-disclaimer`
	- `/music`
	- `/privacy`
	- `/terms`
- The updated internal navigation targets used by this batch also returned `200` locally, including `/about`, `/contact`, `/resources`, `/podcasts`, `/community`, `/youtube`, `/theclub`, `/parkinsons-help-and-support`, `/parkinsons-community`, `/parkinsons-daily-check-in`, and `/parkinsons-symptom-tracker`.
- External reachability checks also succeeded for `https://club.dolifetoday.com/`, `https://dolifetoday.com/privacy`, and `https://dolifetoday.com/terms`.

If the deploy process requires a staging command, the safe file set is:

```powershell
git add public/content-policy.html public/editorial-policy.html public/events.html public/lifeinmotion/index.html public/medical-disclaimer.html public/music.html public/privacy.html public/terms.html
```

## Related Audit Notes

- Main bucket report: `HTML_DEPLOY_BUCKETS_2026-03-27.md`
- The current production-safe podcast hub remains `public/living-with-parkinsons-podcast.html`
- `public/podcast/index.html` is not part of this batch because current hosting redirects `/podcast` and `/podcast/**` to `/living-with-parkinsons-podcast`