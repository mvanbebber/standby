# Notes for Claude

## Writing style
- The owner is American: use **American English** everywhere (app text, README, commit messages),
  e.g. color, center, favorite, practice (never "practise").

## No Sheet! (stage sheet music reader, web app / PWA)
- Named "No Sheet!" (Nov 24, 2026; earlier StandBy, then Holy Sheet!). Icon: amber magnifying glass over a tilted sheet of music ("No Sheet, Sherlock") (`icon.svg`,
  PNGs rendered from it). Internal names stay `standby` (repo, IndexedDB `standby`, cache names) so data is never lost.
- No build step: `index.html`, `app.css`, ES modules in `js/` (see README for what each file does).
  PDF.js 4.10.38 legacy build is vendored in `vendor/pdfjs/`.
- Offline: `sw.js` precaches every file. Bump `VERSION` there with every change (and `APP_VERSION` in `js/app.js`,
  shown in Settings › About and under the sidebar with the credit "Developed by Michael Van Bebber" and
  © `COPYRIGHT_YEAR`), and add new files to `FILES`. The app reloads itself on a new version, never while the reader is open.
- Appearance (Nov 25, 2026): Dark (default) and Light (daytime/outdoor), Settings › Appearance, `S.settings.theme`,
  mirrored to localStorage `ns-theme` for the `<head>` script. All UI colors are CSS variables in `app.css`
  (`:root` dark, `:root[data-theme="light"]` light): new colors need both. `#sbShade` keeps a dark strip behind the
  iPad status bar in light mode (its text is white).
- Data lives in IndexedDB (`js/db.js`): scores, files, thumbs, marks, setlists, libraries (one per band), kv.
  Old `folders` are migrated into libraries on load (`js/store.js`).
- Owner's choices (Nov 24, 2026): libraries replace folders (one per band); half-page turns yes; no bookmarks
  inside scores; native iPad app (Capacitor, for AirDrop "Open in") is on hold.
- forScore import (`js/forscore.js`): .4sb Archive/Backup and .4ss setlists, based on the reverse-engineered
  format from github.com/inet-cologne/forscore-cleanup. Only tested with synthetic files so far.
- Hosted on Netlify from this repo (top level, no build). Each deploy uses Netlify credits.
- Test locally with `python3 -m http.server` and Playwright (Chromium is preinstalled), emulating
  'iPad Pro 11 landscape' and portrait.
