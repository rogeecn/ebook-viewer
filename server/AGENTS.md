# SERVER KNOWLEDGE BASE

## OVERVIEW

Express 5 API serving PDF metadata, rendered page images (PNG), and reading progress.

## MODULE GRAPH

```
index.js (routes + app bootstrap)
├── pdf-renderer.js (MuPDF rendering)
│   ├── cache.js (LRU)
│   └── pdf-index.js (lookup by ID)
├── pdf-index.js (directory scanner + search)
│   └── pdf-cache.js (persistent scan cache)
└── progress-store.js (reading progress persistence)
```

## KEY PATTERNS

- **Two-tier caching in pdf-renderer.js**: `docCache` (Map, unbounded, holds open MuPDF Document objects) + `imageCache` (LRU, 100 entries, holds PNG Buffers). Scale is clamped [0.5, 4.0].
- **pdf-index.js data model**: Three Maps — `byId` (MD5→PdfEntry), `byRelPath` (relPath→PdfEntry), `folderIndex` (path→FolderSummary). Rebuilt fully on each scan.
- **Scan lifecycle**: `startPeriodicScan()` loads cache → if hit, hydrates Maps and defers background rescan 100ms → setInterval for periodic rescans.
- **Atomic persistence**: Both pdf-cache.js and progress-store.js: write to `${path}.tmp` then `fs.renameSync`. Empty catch on cleanup failure.
- **ID generation**: `crypto.createHash('md5').update(relPath).digest('hex')` — deterministic from relative path.
- **MuPDF outline normalization**: `item.page` is 0-indexed from MuPDF, normalized to 1-indexed. Falls back to `doc.resolveLink(item.uri)` for URI-based TOC entries.

## ROUTE PATTERNS

All routes follow: parse params → call service function → return JSON or PNG. No middleware chain. No auth.

Express 5 specifics:
- Wildcard: `app.get('/api/tree/{*path}', ...)` — `req.params.path` (not `req.params[0]`)
- SPA fallback: `app.get('/view/{*splat}', ...)` serves `view.html`

## GOTCHAS

- `doc.destroy()` is called in `extractMetadata` (pdf-index.js) but NOT in pdf-renderer.js — documents in `docCache` are intentionally kept open for reuse
- `scanDirectoryRecursive()` uses iterative stack (not recursion) despite the name
- `mupdf.Document.openDocument(buffer, 'application/pdf')` requires the full file buffer in memory
- Cache version constants (`CACHE_VERSION=2`, `STORE_VERSION=1`) must be bumped when changing JSON schema
