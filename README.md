# dolifetoday
speaking and community websites

## Safe Hosting Deploys

Do not deploy Hosting from a detached `HEAD` worktree populated with only a few copied files. That can silently revert unrelated live assets back to the repository `HEAD` state.

Use the overlay deploy script instead:

```bash
npm run deploy:hosting-overlay -- public/exchange.html public/js/exchange.js
```

What it does:

- Downloads the current live Hosting files from `https://dolifetoday.com` into a temp deploy directory.
- Overlays only the local files you explicitly name.
- Lets you inspect the prepared deploy directory first, or publish immediately with `--deploy`.

Example with deploy:

```bash
npm run deploy:hosting-overlay -- --deploy public/theclub.html public/js/main.js
```

Useful flags:

- `--site <url>` to target a different live site baseline.
- `--temp-dir <path>` to control the temp directory location.
- `--keep-temp` to keep the prepared deploy directory after publishing.
