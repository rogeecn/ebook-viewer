# PDF Render

A self-hosted PDF library and viewer with server-side rendering powered by MuPDF.

PDFs are rendered to images on the server, so the browser only needs to display PNGs — no client-side PDF parsing, fast on any device.

## Features

- **Server-side rendering** — MuPDF renders pages to PNG on the server with LRU caching
- **PDF library** — Auto-scans a directory, builds a browsable folder tree with search
- **Reading progress** — Remembers your last page per document
- **Viewer controls** — Zoom, pan (via panzoom), vertical/horizontal page flip, outline/TOC navigation
- **Recent files** — Tracks recently opened PDFs with pin support
- **Docker ready** — Single container, mount your PDF folder and go

## Quick Start

```bash
# Clone and install
git clone https://github.com/rogeecn/pdf-render.git
cd pdf-render
npm install

# Put PDFs in the pdfs/ directory
mkdir -p pdfs
cp /path/to/your/*.pdf pdfs/

# Start
npm start
# → http://localhost:3000
```

Development mode (auto-reload on file changes):

```bash
npm run dev
```

## Docker

```bash
docker build -t pdf-render .
docker run -d -p 3000:3000 -v /path/to/your/pdfs:/app/pdfs pdf-render
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/pdfs` | List all PDFs (supports `?flat=1` and `?ids=a,b`) |
| `GET` | `/api/tree` | Get folder tree from root |
| `GET` | `/api/tree/:path` | Get folder tree for subdirectory |
| `GET` | `/api/search?q=keyword` | Search PDF filenames |
| `GET` | `/api/pdf/:id/info` | Page dimensions and count |
| `GET` | `/api/pdf/:id/page/:num?scale=1.5` | Render page as PNG |
| `GET` | `/api/pdf/:id/outline` | Table of contents |
| `GET` | `/api/pdf/:id/meta` | File metadata |
| `GET` | `/api/progress/:id` | Get reading progress |
| `PUT` | `/api/progress/:id` | Save reading progress (`{ "page": N }`) |

## Tech Stack

- **Runtime** — Node.js (ESM)
- **Server** — Express 5
- **PDF engine** — [MuPDF](https://mupdf.com/) (via `mupdf` npm package)
- **Zoom/Pan** — [@panzoom/panzoom](https://github.com/timmywil/panzoom)

## Project Structure

```
server/
  index.js           # Express app and API routes
  pdf-renderer.js    # MuPDF rendering with document and image caching
  pdf-index.js       # PDF directory scanner with MD5 dedup and search
  pdf-cache.js       # Persistent scan cache
  cache.js           # LRU cache implementation
  progress-store.js  # Reading progress persistence
public/
  index.html         # Library page
  view.html          # Viewer page
  css/               # Styles (dark glassmorphism theme)
  js/                # Client modules (viewer, controls, list)
```

## License

MIT
