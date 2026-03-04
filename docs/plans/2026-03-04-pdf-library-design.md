# PDF Library Production Design

## Overview

Upgrade the existing PDF viewer prototype into a production-ready PDF library system. The system serves PDF files from a designated directory, provides a simple list view for browsing, and a full-featured viewer for reading.

## Requirements

- No authentication required
- PDF files placed in a single directory
- Simple file list (no thumbnails, no search)
- MD5-based ID with automatic deduplication
- Docker deployment

## Architecture

### URL Routes

| Route | Purpose |
|-------|---------|
| `GET /` | PDF library list page |
| `GET /view/:id` | PDF viewer page |
| `GET /api/pdfs` | List all PDFs (JSON) |
| `GET /api/pdf/:id/info` | Get PDF metadata |
| `GET /api/pdf/:id/page/:pageNum` | Render page as PNG |
| `GET /api/pdf/:id/outline` | Get PDF outline/bookmarks |

### Backend Components

#### PDF Index Service (`server/pdf-index.js`)

Responsibilities:
1. Scan `PDF_DIR` on startup
2. Calculate MD5 hash for each file (used as unique ID)
3. Deduplicate: same MD5 = same PDF, keep first occurrence
4. Extract metadata: original filename, page count, file size
5. Schedule periodic scans (default: 30 minutes)

Data structure:
```javascript
// In-memory index
Map<md5, { id: string, filename: string, pageCount: number, size: number, filePath: string }>
```

Scanning strategy:
- Full scan on startup
- Incremental scan every `SCAN_INTERVAL` ms
- Compare file mtimes for efficiency (skip unchanged files)
- Remove entries for deleted files

#### PDF Renderer (`server/pdf-renderer.js`)

Existing module, minimal changes:
- Accept MD5 ID instead of filename-based ID
- Look up file path from index

#### Cache (`server/cache.js`)

Existing LRU cache, no changes needed.

### Frontend Components

#### List Page (`public/index.html`)

New entry point. Features:
- Display PDF list with filename, page count, file size
- Click to open viewer
- Simple, clean design matching existing dark theme

#### Viewer Page (`public/view.html`)

Renamed from `index.html`. Changes:
- Read PDF ID from URL path: `/view/:id`
- Add "Back to Library" button in toolbar
- All existing functionality preserved

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `PDF_DIR` | `./pdfs` | Directory containing PDF files |
| `SCAN_INTERVAL` | 1800000 | Scan interval in ms (30 min) |

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

EXPOSE 3000

VOLUME /app/pdfs

CMD ["node", "server/index.js"]
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  pdf-library:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./pdfs:/app/pdfs:ro
    environment:
      - PORT=3000
      - PDF_DIR=/app/pdfs
      - SCAN_INTERVAL=1800000
    restart: unless-stopped
```

## Error Handling

- PDF not found → 404 with friendly message
- Invalid page number → 400 with error details
- Scan errors → logged, don't crash server
- Missing PDF_DIR → create on startup with warning

## File Structure After Implementation

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── pdfs/                    # User's PDF files (volume mount)
├── public/
│   ├── index.html           # List page (NEW)
│   ├── view.html            # Viewer page (renamed)
│   ├── css/style.css
│   └── js/
│       ├── app.js           # List page logic (NEW)
│       ├── viewer-app.js    # Viewer page logic (renamed)
│       ├── viewer.js
│       ├── controls.js
│       └── vendor/
└── server/
    ├── index.js             # Express server
    ├── pdf-index.js         # Index service (NEW)
    ├── pdf-renderer.js      # Rendering logic
    └── cache.js             # LRU cache
```