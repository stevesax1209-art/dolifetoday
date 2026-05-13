# Share Assets Folder

Drop your shareable assets here. They'll be live at:
**https://dolifetoday.com/share-assets/<filename>**

Suggested structure (create subfolders as you upload):

```
share-assets/
  videos/
    15s-commercial-1.mp4
    15s-commercial-1.webm        (smaller, web-optimized — optional)
    15s-commercial-1-poster.jpg  (thumbnail poster image)
    15s-commercial-2.mp4
    ...
  graphics/
    instagram-square-1.png       (1080×1080)
    instagram-story-1.png        (1080×1920)
    facebook-post-1.png          (1200×630)
    quote-card-1.png
    ...
  pdfs/
    support-group-onepager.pdf
    flyer-print.pdf
    clinician-handout.pdf
    bryce-bio.pdf
    ...
```

## Naming tips

- Use lowercase, dashes (no spaces): `journey-guide-flyer.pdf` not `Journey Guide Flyer.pdf`
- Add a brief descriptor + size: `instagram-square-bryce-quote.png`
- For videos, ship both `.mp4` (universal) and optionally `.webm` (smaller for modern browsers)
- For each video, drop a `*-poster.jpg` thumbnail next to it

## What the /share page expects

The `/share` page (public/share.html) lists assets by filename. After you drop files in here:
1. Open `public/share.html`
2. Find the `<!-- ASSET LISTS -->` comment near the top of the script
3. Add the filename + a short description to the right list (videos / graphics / pdfs)
4. Deploy — that's it

Example:
```js
const VIDEOS = [
  { file: 'videos/15s-commercial-1.mp4', poster: 'videos/15s-commercial-1-poster.jpg', title: 'What The Club is — 15 sec', description: 'Quick intro to the community.' },
];
```
