# Epzin — Precision Image Studio

> In-browser image upscaling, colour fixing, ICC profile embedding, and hardware simulation. Zero server uploads. Forever free. GitHub Pages hosted.

## Features

| Feature | Details |
|---|---|
| **Upscaling** | Lanczos, Bicubic, Nearest Neighbour, R-ESRGAN-style sharpening |
| **CLAHE** | Adaptive contrast, gentle 1.5 clip limit, 8×8 tile |
| **Film Grain** | Monochromatic (no colour speckling), Box-Muller distribution |
| **ICC Profiles** | sRGB · Adobe RGB (1998) · Apple RGB · ColorMatch RGB — generated in-browser |
| **Hardware Filters** | iPhone 6 (warm, vignette) · iPhone 6s (cooler, better highlights) |
| **Export** | PNG (lossless + ICC) or JPEG Q95 + ICC, no EXIF written |
| **Privacy** | 100% client-side, no uploads ever, COI ServiceWorker for cross-origin isolation |

## Deploy to GitHub Pages

### Option A — Automatic (recommended)

1. **Fork** or push this repo to your GitHub account.
2. Go to **Settings → Pages**.
3. Under **Source**, select **GitHub Actions**.
4. Push any commit to `main` — the workflow in `.github/workflows/deploy.yml` handles everything.
5. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

### Option B — Manual branch

1. Go to **Settings → Pages**.
2. Under **Source**, select **Deploy from a branch → main → / (root)**.
3. GitHub Pages will serve `index.html` directly.

## Local Development

No build step required — pure static files.

```bash
# Any static server works, e.g.:
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

> **Note on COI:** The `coi-serviceworker.js` script adds `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers via a Service Worker, enabling `SharedArrayBuffer` on GitHub Pages without server config. This is what prevents the fingerprinting/isolation errors common in image-processing web apps.

## Architecture

```
epzin/
├── index.html               # UI — all tabs, controls, result panel
├── coi-serviceworker.js     # Cross-origin isolation (COOP/COEP headers)
├── css/
│   └── style.css            # Full stylesheet (dark industrial theme)
├── js/
│   ├── icc-profiles.js      # Pure-JS ICC v2 profile generator + PNG/JPEG embedder
│   ├── epzin-engine.js      # All image processing (resize, CLAHE, grain, filters, export)
│   └── app.js               # UI controller, pipeline orchestration
└── .github/
    └── workflows/
        └── deploy.yml       # GitHub Actions → Pages deployment
```

## ICC Profile Notes

All four ICC profiles are **generated mathematically at runtime** from CIE primaries and whitepoint data. No `.icc` files are bundled. The profiles are embedded as:
- **PNG:** `iCCP` chunk (deflate-stored, zlib-wrapped)
- **JPEG:** `APP2` marker (`ICC_PROFILE\0` identifier)

## Privacy & Fingerprinting

- **No EXIF written.** Output files contain only pixel data + ICC profile.
- **No uploads.** `canvas.toBlob()` → `URL.createObjectURL()` — stays in memory.
- **Hardware filters** are pure pixel transforms, no device metadata.
- **COI ServiceWorker** injects isolation headers without a custom server — the standard solution for GitHub Pages hosted image tools.

## License

MIT
