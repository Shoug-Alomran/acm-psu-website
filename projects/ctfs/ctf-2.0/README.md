# CTF 2.0 archive

This directory preserves the ACM/CyberTech CTF 2.0 event record and its Spring 2026 preparation programme.

## Structure

- `results/presentation/`: archived six-slide interactive results deck. It contains participant names and is marked `noindex, nofollow`.
- `results/source/`: original source records retained for internal verification. Do not link these files directly from public pages.
- `workshops/`: five ordered web-security workshop modules. Each module keeps its participant handout, slide deck, and/or cheat sheet together.
- `archive-manifest.js`: public resource metadata consumed by `/ctf-2-resources.html`.

The website links the privacy-safe competition report at `/assets/reports/public/ctf-2-results-report-public.pdf`, not the original member-level report in `results/source/`.

## Adding another version

Create new workshop module folders inside the relevant CTF edition, keep filenames role-based (`participant-handout.pdf`, `slide-deck.pdf`, `cheat-sheet.pdf`), and add the files to that edition's `archive-manifest.js`. Each CTF edition has its own folder under `projects/ctfs/`, so no semester layer is needed.
