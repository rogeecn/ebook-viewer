# SERVER KNOWLEDGE BASE

## OVERVIEW

Express 5 API serving ebook metadata, rendered page images (PNG), and reading progress.

## MODULE GRAPH

```
index.js (routes + app bootstrap)
├── ebook-renderer.js (MuPDF rendering)
│   ├── cache.js (LRU)
│   ├── ebook-index.js (lookup by ID)
│   └── html-sanitizer.js (HTML sanitization, MD→HTML conversion, reflowable layout)
├── ebook-index.js (directory scanner + search)
│   ├── ebook-cache.js (persistent scan cache)
│   └── html-sanitizer.js (preprocessing for new formats)
└── progress-store.js (reading progress persistence)
```

## KEY PATTERNS

- **Preprocessing pipeline**: HTML/MD/XHTML files go through `html-sanitizer.js` before MuPDF: strips `<script>`, `<iframe>`, `on*` handlers, `javascript:` URLs. MD files are converted to HTML via `markdown-it` first.
- **Reflowable layout**: Formats like EPUB, MOBI, FB2, HTML, XHTML, MD call `doc.layout(595, 842, 12)` after `openDocument()` — A4 at 12pt font size. `doc.isReflowable()` is unreliable in WASM build, so `isReflowable()` in html-sanitizer.js provides the check.
- **Two-tier caching in ebook-renderer.js**: `docCache` (Map, unbounded, holds open MuPDF Document objects) + `imageCache` (LRU, 100 entries, holds PNG Buffers). Scale is clamped [0.5, 4.0].
- **ebook-index.js data model**: Three Maps — `byId` (MD5→EbookEntry), `byRelPath` (relPath→EbookEntry), `folderIndex` (path→FolderSummary). Rebuilt fully on each scan.
- **Scan lifecycle**: `startPeriodicScan()` loads cache → if hit, hydrates Maps and defers background rescan 100ms → setInterval for periodic rescans.
- **Atomic persistence**: Both ebook-cache.js and progress-store.js: write to `${path}.tmp` then `fs.renameSync`. Empty catch on cleanup failure.
- **ID generation**: `crypto.createHash('md5').update(relPath).digest('hex')` — deterministic from relative path.
- **MuPDF outline normalization**: `item.page` is 0-indexed from MuPDF, normalized to 1-indexed. Falls back to `doc.resolveLink(item.uri)` for URI-based TOC entries.

## ROUTE PATTERNS

All routes follow: parse params → call service function → return JSON or PNG. No middleware chain. No auth.

Express 5 specifics:
- Wildcard: `app.get('/api/tree/{*path}', ...)` — `req.params.path` (not `req.params[0]`)
- SPA fallback: `app.get('/view/{*splat}', ...)` serves `view.html`

## GOTCHAS

- `doc.destroy()` is called in `extractMetadata` (ebook-index.js) but NOT in ebook-renderer.js — documents in `docCache` are intentionally kept open for reuse
- `scanDirectoryRecursive()` uses iterative stack (not recursion) despite the name
- `mupdf.Document.openDocument(buffer, 'application/pdf')` requires the full file buffer in memory
- Cache version constants (`CACHE_VERSION=5`, `STORE_VERSION=1`) must be bumped when changing JSON schema
