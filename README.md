# Tenang

A mobile-first web app for people with high blood pressure: breathing exercises, nervous-system resets, a 30-day path, readings log, a doctor-ready summary, a plain-English medicines guide, and an animated 3D explanation of top vs bottom blood pressure numbers.

Information only, not medical advice.

## Files
- `index.html` – the whole app (single file, no build step)
- `worker.js` – single-file Cloudflare Worker serving the app, manifest and icons
- `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `_headers` – PWA assets

## Deploy
```
npx wrangler deploy worker.js --name tenang --compatibility-date 2026-10-01
```
