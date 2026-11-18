# Soba

- `docs/` — marketing site at usesoba.com, served by the existing Vercel `soba-site` project (root directory: `docs`).
- `app/` — separate application; not part of the homepage preview.

## Marketing site

The site retains its existing static Framer layout. Edit the copy and layout overrides in `docs/preview/src/overlay.py`, `soba.js`, and `soba.css`. The use-case cards and illustrative workflow are in `use-cases.html` and `workflow.html`.

Build the published HTML:

```sh
python3 docs/preview/src/overlay.py all
```

Preview locally:

```sh
python3 -m http.server 4173 --directory docs
```

Image credit is recorded in `docs/img/SOURCES.md`.
