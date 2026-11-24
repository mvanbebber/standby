# Notes for Claude

## Writing style
- The owner is American: use **American English** everywhere (app text, README, commit messages),
  e.g. color, center, favorite, practice (never "practise").

## StandBy (stage sheet music reader, web app / PWA)
- No build step: `index.html`, `app.css`, ES modules in `js/` (see README for what each file does).
  PDF.js 4.10.38 legacy build is vendored in `vendor/pdfjs/`.
- Offline: `sw.js` precaches every file. Bump `VERSION` there with every change (and `APP_VERSION` in `js/app.js`,
  shown in Settings), and add new files to `FILES`. The app reloads itself on a new version, never while the reader is open.
- Data lives in IndexedDB (`js/db.js`): scores, files, thumbs, marks, setlists, libraries (one per band), kv.
  Old `folders` are migrated into libraries on load (`js/store.js`).
- Owner's choices (Nov 24, 2026): libraries replace folders (one per band); half-page turns yes; no bookmarks
  inside scores; native iPad app (Capacitor, for AirDrop "Open in") is on hold.
- forScore import (`js/forscore.js`): .4sb Archive/Backup and .4ss setlists, based on the reverse-engineered
  format from github.com/inet-cologne/forscore-cleanup. Only tested with synthetic files so far.
- Hosted on Netlify from this repo (top level, no build). Each deploy uses Netlify credits.
- Test locally with `python3 -m http.server` and Playwright (Chromium is preinstalled), emulating
  'iPad Pro 11 landscape' and portrait.
