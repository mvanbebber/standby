# StandBy: sheet music for the stage

A fast, offline PDF music reader for iPad (also works on computers and phones). Working title.

## What it does
- **Library**: add PDFs once (pick several in Files, or drag them in) and they're ready. No second import step.
  Adding while a setlist is open puts the new music straight into it.
- **Libraries**: one per band. The library switcher at the top left picks which band's music and setlists you see.
  A score can be moved or copied to another library (copies keep their own marks).
- **Setlists**: drag the ≡ handle to reorder. Start plays the whole set: turning past the last page goes straight
  to the next song, and a "Next: …" badge shows on the last page.
- **Fast page turns**: one shared PDF.js worker, pages rendered ahead into a small cache (the next two pages, the
  previous turn, and the next song's first page near the end of a song). Prefetched turns take under 1 ms.
- **Draw mode**: pen, highlighter, eraser (rub over a mark), text, and 36 stamps (dynamics, articulations,
  accidentals, segno/coda, V.S., rit., glasses, fingerings…), 6 colors, 3 sizes, undo/redo, clear page.
  Every button has a word under it. Apple Pencil can write without entering Draw mode (Settings).
- **Stage features**: tap right side to go forward, left third (or half) to go back, top strip for the menu;
  swipe; half-page turns (top half shows what's next while you finish the bottom; drag the orange line to set the split, remembered per page); Bluetooth page-turn pedals (arrows, Page Up/Down, Space); two pages side by side when sideways;
  Night pages; screen stays awake while reading.
- **Offline**: a service worker caches the whole app; PDFs and marks live in IndexedDB on the device.
- **Backup**: Settings › Back up library saves one .zip (PDFs, marks, setlists, folders); pick it with
  Add PDFs or Restore to bring everything back.

- **Import from forScore** (Settings): an Archive `.4sb` brings in PDFs, titles, composers, libraries, setlists,
  text notes and handwriting (forScore keeps handwriting as one PNG per page; it shows as a layer that Clear page removes).
  A Backup `.4sb` has no PDFs, so it's matched by file name to PDFs already added. Setlists `.4ss`: the shared
  container kind and the XML kind; songs are matched by file name, then title. Bookmarks inside PDFs aren't supported:
  setlist entries that point to one open the whole PDF. Format notes: `js/forscore.js` (thanks to
  github.com/inet-cologne/forscore-cleanup for the reverse-engineered layout).

## Files
No build step. `index.html` + `app.css`, ES modules in `js/`:
`app.js` (libraries, setlists, import, settings, backup), `forscore.js` (forScore files), `viewer.js` (reader, setlist flow),
`render.js` (PDF.js, render queue, page cache), `ink.js` (drawing, stamps), `ui.js` (dialogs),
`db.js` (IndexedDB), `store.js` (state, settings), `zip.js` (backup files). `sw.js` is the offline cache:
bump `VERSION` there with every change. PDF.js 4.10.38 (legacy build, Apache-2.0) is in `vendor/pdfjs/`.

## Run locally
    python3 -m http.server 8000

## Host it
Any static host over HTTPS. On Netlify: a new site from this repo, base and publish directory left empty
(`netlify.toml` sets no build step). On the iPad open the site in Safari, then Share › Add to Home Screen for a full-screen app.

## AirDrop
A web app can't appear in the AirDrop/"Open in" list on iPad (Safari doesn't support it). AirDropped PDFs land
in Files › Downloads, and Add PDFs opens right there (pick many at once). For true one-tap AirDrop → StandBy, the
same code can be wrapped as a native iPad app with Capacitor (needs a Mac with Xcode and an Apple Developer account).
