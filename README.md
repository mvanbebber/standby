# StandBy: sheet music for the stage

A fast, offline PDF music reader for iPad (also works on computers and phones). Working title.

## What it does
- **Library**: add PDFs once (pick several in Files, or drag them in) and they're ready. No second import step.
  Adding while a folder or setlist is open puts the new music straight into it.
- **Folders**: one folder per score, with search and sort (title, composer, newest).
- **Setlists**: drag the ≡ handle to reorder. Start plays the whole set: turning past the last page goes straight
  to the next song, and a "Next: …" badge shows on the last page.
- **Fast page turns**: one shared PDF.js worker, pages rendered ahead into a small cache (the next two pages, the
  previous turn, and the next song's first page near the end of a song). Prefetched turns take under 1 ms.
- **Draw mode**: pen, highlighter, eraser (rub over a mark), text, and 36 stamps (dynamics, articulations,
  accidentals, segno/coda, V.S., rit., glasses, fingerings…), 6 colors, 3 sizes, undo/redo, clear page.
  Every button has a word under it. Apple Pencil can write without entering Draw mode (Settings).
- **Stage features**: tap right side to go forward, left third (or half) to go back, top strip for the menu;
  swipe; Bluetooth page-turn pedals (arrows, Page Up/Down, Space); two pages side by side when sideways;
  Night pages; screen stays awake while reading.
- **Offline**: a service worker caches the whole app; PDFs and marks live in IndexedDB on the device.
- **Backup**: Settings › Back up library saves one .zip (PDFs, marks, setlists, folders); pick it with
  Add PDFs or Restore to bring everything back.

## Files
No build step. `index.html` + `app.css`, ES modules in `js/`:
`app.js` (library, folders, setlists, import, settings, backup), `viewer.js` (reader, setlist flow),
`render.js` (PDF.js, render queue, page cache), `ink.js` (drawing, stamps), `ui.js` (dialogs),
`db.js` (IndexedDB), `store.js` (state, settings), `zip.js` (backup files). `sw.js` is the offline cache:
bump `VERSION` there with every change. PDF.js 4.10.38 (legacy build, Apache-2.0) is in `vendor/pdfjs/`.

## Run locally
    cd standby && python3 -m http.server 8000

## Host it
Any static host over HTTPS. On Netlify: a new site from this repo with base directory `standby`, no build
command. On the iPad open the site in Safari, then Share › Add to Home Screen for a full-screen app.

## AirDrop
A web app can't appear in the AirDrop/"Open in" list on iPad (Safari doesn't support it). AirDropped PDFs land
in Files › Downloads, and Add PDFs opens right there (pick many at once). For true one-tap AirDrop → StandBy, the
same code can be wrapped as a native iPad app with Capacitor (needs a Mac with Xcode and an Apple Developer account).
