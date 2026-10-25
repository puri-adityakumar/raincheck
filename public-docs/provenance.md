# Provenance and local assets

## Diorama

- Original attachment: user-supplied fishing-diorama HTML, retained unchanged locally. Its local filename and machine path are not published.
- SHA-256: `b11021c804f6edd65eab2ddc94a5e6783c8cbca1140efc5c08c2013ef847c45f`
- Port: `frontend/src/components/FishingDiorama.tsx`
- The SDF raymarch shader, palette, fish steering, pointer ripples and Bayer dithering are preserved. React lifecycle guards, resize/DPR caps, keyboard input, pause, visibility/offscreen handling, reduced-motion stillness, context-loss fallback and cleanup were added.
- No original file was edited or copied over.

## Fonts

Bundled locally via Fontsource (woff2 + woff), no CDN:

| Family | Package | Version | Weight | License |
| --- | --- | --- | --- | --- |
| Geist Sans | `@fontsource/geist-sans` | 5.3.0 | 400/500/600 | OFL-1.1 |
| Geist Mono | `@fontsource/geist-mono` | 5.3.0 | 400/500 | OFL-1.1 |
| Geist Pixel | `@fontsource/geist-pixel` | 5.3.0 | 400 | OFL-1.1 |

Font metadata from each package reports © The Geist Project Authors, source `github.com/vercel/geist-font`, redistributed by Fontsource.

## Weather

Implemented provider: [Open-Meteo](https://open-meteo.com/) geocoding and forecast APIs, keyless, fixed hosts. Weather and tickets include attribution text and a fetch timestamp. Real unpaid weather was checked locally; automated tests use explicit upstream fixtures. See `https://open-meteo.com/en/docs` and `https://open-meteo.com/en/docs/geocoding-api`.

## Stack

- React 19.3.1, React DOM 19.3.1
- Vite 8.3.5, TypeScript 5.9.3
- Tailwind CSS 4.3.3
- FastAPI 0.162.0, Pydantic 2.14.1, SQLAlchemy 2.1.6
- Python 3.12.13, Node 22 LTS for the Docker build

Versions are pinned in `frontend/package-lock.json`, `backend/uv.lock`, and the Dockerfile. No paid assets or stock illustrations are used.
