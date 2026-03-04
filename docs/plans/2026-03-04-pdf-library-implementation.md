# PDF Library Production Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the single-PDF viewer prototype into a production-ready PDF library with file list, deduplication, and Docker deployment.

**Architecture:** 
- Backend: Express server with PDF index service that scans directory, calculates MD5 hashes for deduplication, and serves metadata
- Frontend: Two-page SPA (list + viewer) with URL-based routing
- Docker: Alpine-based container with volume mount for PDF files

**Tech Stack:** Express 5, mupdf, vanilla JS, Docker

---

## Task 1: Create PDF Index Service

**Files:**
- Create: `server/pdf-index.js`

**Step 1: Write the index service module**

```javascript
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as mupdf from 'mupdf'

const PDF_DIR = process.env.PDF_DIR || path.resolve('pdfs')
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || '1800000', 10)

// In-memory index: Map<md5, PdfEntry>
const index = new Map()

// Path to MD5 mapping for change detection
const pathToMd5 = new Map()

/**
 * @typedef {Object} PdfEntry
 * @property {string} id - MD5 hash
 * @property {string} filename - Original filename
 * @property {number} pageCount - Number of pages
 * @property {number} size - File size in bytes
 * @property {string} filePath - Absolute file path
 */

/**
 * Calculate MD5 hash of a file
 */
function calculateMd5(filePath) {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buffer).digest('hex')
}

/**
 * Extract PDF metadata
 */
function extractMetadata(filePath) {
  const buffer = fs.readFileSync(filePath)
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const pageCount = doc.countPages()
  const stats = fs.statSync(filePath)
  
  return {
    pageCount,
    size: stats.size
  }
}

/**
 * Scan directory and build index
 */
export function scanDirectory() {
  console.log(`Scanning PDF directory: ${PDF_DIR}`)
  
  if (!fs.existsSync(PDF_DIR)) {
    console.warn(`PDF directory does not exist: ${PDF_DIR}, creating...`)
    fs.mkdirSync(PDF_DIR, { recursive: true })
    return
  }
  
  const files = fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
  
  const newPaths = new Set()
  let added = 0
  let skipped = 0
  
  for (const file of files) {
    const filePath = path.join(PDF_DIR, file)
    
    try {
      // Check if we already have this path indexed
      const existingMd5 = pathToMd5.get(filePath)
      
      // Skip if file hasn't changed (same mtime)
      const stats = fs.statSync(filePath)
      
      let md5
      if (existingMd5 && index.has(existingMd5)) {
        // Already indexed, skip MD5 calculation
        md5 = existingMd5
        newPaths.add(filePath)
        continue
      }
      
      // Calculate MD5 and check for duplicates
      md5 = calculateMd5(filePath)
      
      if (index.has(md5)) {
        // Duplicate file, skip
        skipped++
        newPaths.add(filePath) // Track path for deletion detection
        pathToMd5.set(filePath, md5)
        continue
      }
      
      // New unique file
      const metadata = extractMetadata(filePath)
      
      index.set(md5, {
        id: md5,
        filename: file,
        pageCount: metadata.pageCount,
        size: metadata.size,
        filePath
      })
      
      pathToMd5.set(filePath, md5)
      newPaths.add(filePath)
      added++
      
    } catch (err) {
      console.error(`Failed to process ${file}:`, err.message)
    }
  }
  
  // Remove entries for deleted files
  for (const [oldPath, md5] of pathToMd5) {
    if (!newPaths.has(oldPath)) {
      const entry = index.get(md5)
      if (entry && entry.filePath === oldPath) {
        index.delete(md5)
      }
      pathToMd5.delete(oldPath)
    }
  }
  
  console.log(`Scan complete: ${index.size} PDFs indexed (${added} added, ${skipped} duplicates skipped)`)
}

/**
 * Get all PDFs as array
 */
export function getAllPdfs() {
  return Array.from(index.values())
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

/**
 * Get PDF entry by ID
 */
export function getPdfById(id) {
  return index.get(id) || null
}

/**
 * Start periodic scanning
 */
export function startPeriodicScan() {
  setInterval(() => {
    try {
      scanDirectory()
    } catch (err) {
      console.error('Periodic scan failed:', err)
    }
  }, SCAN_INTERVAL)
  console.log(`Periodic scanning enabled: every ${SCAN_INTERVAL / 1000 / 60} minutes`)
}

// Initialize on import
scanDirectory()
```

**Step 2: Commit**

```bash
git add server/pdf-index.js
git commit -m "feat: add PDF index service with MD5 deduplication"
```

---

## Task 2: Update PDF Renderer to Use Index

**Files:**
- Modify: `server/pdf-renderer.js`

**Step 1: Update imports and document loading**

Replace the existing content with:

```javascript
import * as mupdf from 'mupdf'
import { LRUCache } from './cache.js'
import { getPdfById } from './pdf-index.js'

const imageCache = new LRUCache(100)
const docCache = new Map()

function getDocument(pdfId) {
  if (docCache.has(pdfId)) {
    return docCache.get(pdfId)
  }

  const entry = getPdfById(pdfId)
  if (!entry) {
    return null
  }

  const buffer = await import('node:fs').then(fs => fs.readFileSync(entry.filePath))
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  docCache.set(pdfId, doc)
  return doc
}

export function getPdfInfo(pdfId) {
  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pages = []

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    pages.push({
      index: i,
      width: Math.round(bounds[2] - bounds[0]),
      height: Math.round(bounds[3] - bounds[1]),
    })
  }

  const entry = getPdfById(pdfId)
  return {
    id: pdfId,
    filename: entry?.filename,
    pageCount,
    pages,
  }
}

function normalizeOutlineItem(item, doc) {
  let page = null
  
  if (typeof item.page === 'number') {
    page = item.page + 1
  } else if (item.uri && doc) {
    try {
      const pageIndex = doc.resolveLink(item.uri)
      if (typeof pageIndex === 'number') {
        page = pageIndex + 1
      }
    } catch (e) {}
  }
  
  return {
    title: item.title || 'Untitled',
    page,
    uri: item.uri || null,
    children: item.down ? item.down.map(child => normalizeOutlineItem(child, doc)) : []
  }
}

export function getPdfOutline(pdfId) {
  const doc = getDocument(pdfId)
  if (!doc) return []

  try {
    const outline = doc.loadOutline()
    if (!outline || outline.length === 0) return []
    return outline.map(item => normalizeOutlineItem(item, doc))
  } catch (err) {
    console.error(`Failed to load outline for ${pdfId}:`, err)
    return []
  }
}

export function renderPage(pdfId, pageNum, scale = 1.5) {
  if (scale < 0.5) scale = 0.5
  if (scale > 4.0) scale = 4.0

  const cacheKey = `${pdfId}:${pageNum}:${scale}`
  const cached = imageCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pageIndex = pageNum - 1
  if (pageIndex < 0 || pageIndex >= pageCount) return null

  const page = doc.loadPage(pageIndex)
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB
  )
  const pngBuffer = pixmap.asPNG()

  imageCache.set(cacheKey, Buffer.from(pngBuffer))

  return Buffer.from(pngBuffer)
}
```

Wait, the `getDocument` function uses async import which is unnecessary. Let me fix:

```javascript
import * as fs from 'node:fs'
import * as mupdf from 'mupdf'
import { LRUCache } from './cache.js'
import { getPdfById } from './pdf-index.js'

const imageCache = new LRUCache(100)
const docCache = new Map()

function getDocument(pdfId) {
  if (docCache.has(pdfId)) {
    return docCache.get(pdfId)
  }

  const entry = getPdfById(pdfId)
  if (!entry) {
    return null
  }

  const buffer = fs.readFileSync(entry.filePath)
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  docCache.set(pdfId, doc)
  return doc
}

export function getPdfInfo(pdfId) {
  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pages = []

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const bounds = page.getBounds()
    pages.push({
      index: i,
      width: Math.round(bounds[2] - bounds[0]),
      height: Math.round(bounds[3] - bounds[1]),
    })
  }

  const entry = getPdfById(pdfId)
  return {
    id: pdfId,
    filename: entry?.filename,
    pageCount,
    pages,
  }
}

function normalizeOutlineItem(item, doc) {
  let page = null
  
  if (typeof item.page === 'number') {
    page = item.page + 1
  } else if (item.uri && doc) {
    try {
      const pageIndex = doc.resolveLink(item.uri)
      if (typeof pageIndex === 'number') {
        page = pageIndex + 1
      }
    } catch (e) {}
  }
  
  return {
    title: item.title || 'Untitled',
    page,
    uri: item.uri || null,
    children: item.down ? item.down.map(child => normalizeOutlineItem(child, doc)) : []
  }
}

export function getPdfOutline(pdfId) {
  const doc = getDocument(pdfId)
  if (!doc) return []

  try {
    const outline = doc.loadOutline()
    if (!outline || outline.length === 0) return []
    return outline.map(item => normalizeOutlineItem(item, doc))
  } catch (err) {
    console.error(`Failed to load outline for ${pdfId}:`, err)
    return []
  }
}

export function renderPage(pdfId, pageNum, scale = 1.5) {
  if (scale < 0.5) scale = 0.5
  if (scale > 4.0) scale = 4.0

  const cacheKey = `${pdfId}:${pageNum}:${scale}`
  const cached = imageCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const doc = getDocument(pdfId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pageIndex = pageNum - 1
  if (pageIndex < 0 || pageIndex >= pageCount) return null

  const page = doc.loadPage(pageIndex)
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB
  )
  const pngBuffer = pixmap.asPNG()

  imageCache.set(cacheKey, Buffer.from(pngBuffer))

  return Buffer.from(pngBuffer)
}
```

**Step 2: Commit**

```bash
git add server/pdf-renderer.js
git commit -m "refactor: update pdf-renderer to use index service"
```

---

## Task 3: Update Express Server with New Routes

**Files:**
- Modify: `server/index.js`

**Step 1: Update server with new routes**

```javascript
import express from 'express'
import path from 'node:path'
import { getPdfInfo, renderPage, getPdfOutline } from './pdf-renderer.js'
import { getAllPdfs, startPeriodicScan } from './pdf-index.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.static(path.resolve('public')))

// API: List all PDFs
app.get('/api/pdfs', (req, res) => {
  const pdfs = getAllPdfs()
  res.json(pdfs)
})

// API: Get PDF info
app.get('/api/pdf/:id/info', (req, res) => {
  const { id } = req.params
  const info = getPdfInfo(id)

  if (!info) {
    return res.status(404).json({ error: `PDF "${id}" not found` })
  }

  res.json(info)
})

// API: Render page
app.get('/api/pdf/:id/page/:pageNum', (req, res) => {
  const { id, pageNum } = req.params
  const scale = parseFloat(req.query.scale) || 1.5
  const page = parseInt(pageNum, 10)

  if (isNaN(page) || page < 1) {
    return res.status(400).json({ error: 'Invalid page number' })
  }

  const png = renderPage(id, page, scale)

  if (!png) {
    return res.status(404).json({ error: `Page ${page} not found for PDF "${id}"` })
  }

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': png.length,
    'Cache-Control': 'public, max-age=3600',
  })
  res.send(png)
})

// API: Get PDF outline
app.get('/api/pdf/:id/outline', (req, res) => {
  const { id } = req.params
  const items = getPdfOutline(id)
  res.json({ items })
})

// SPA fallback: /view/* → view.html
app.get('/view/*', (req, res) => {
  res.sendFile(path.resolve('public/view.html'))
})

// SPA fallback: / → index.html (list page)
app.get('/', (req, res) => {
  res.sendFile(path.resolve('public/index.html'))
})

// Start periodic scanning
startPeriodicScan()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Library server running at http://0.0.0.0:${PORT}`)
})
```

**Step 2: Commit**

```bash
git add server/index.js
git commit -m "feat: add PDF list API and SPA routing"
```

---

## Task 4: Create PDF List Page

**Files:**
- Create: `public/index.html`
- Create: `public/js/list.js`

**Step 1: Create the list page HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Library</title>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/list.css">
</head>
<body>
  <div id="app">
    <div id="header">
      <h1>PDF Library</h1>
      <span id="pdf-count"></span>
    </div>
    <div id="pdf-list">
      <div class="loading">Loading...</div>
    </div>
  </div>
  <script type="module" src="/js/list.js"></script>
</body>
</html>
```

**Step 2: Create the list page CSS**

Create `public/css/list.css`:

```css
#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

#header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #323639;
  color: #fff;
  border-bottom: 1px solid #1a1a1a;
}

#header h1 {
  font-size: 20px;
  font-weight: 500;
}

#pdf-count {
  font-size: 14px;
  color: #ccc;
}

#pdf-list {
  flex: 1;
  padding: 16px 24px;
  background: #525659;
}

#pdf-list .loading {
  color: #ccc;
  text-align: center;
  padding: 40px;
}

#pdf-list .empty {
  color: #999;
  text-align: center;
  padding: 40px;
}

.pdf-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.2s;
}

.pdf-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.pdf-item:focus {
  outline: none;
  box-shadow: 0 0 0 2px #4a9eff;
}

.pdf-info {
  flex: 1;
  min-width: 0;
}

.pdf-filename {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pdf-meta {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}

.pdf-arrow {
  color: #999;
  font-size: 18px;
  margin-left: 12px;
}
```

**Step 3: Create the list page JavaScript**

```javascript
async function loadPdfList() {
  const listEl = document.getElementById('pdf-list')
  const countEl = document.getElementById('pdf-count')

  try {
    const res = await fetch('/api/pdfs')
    if (!res.ok) throw new Error('Failed to load PDF list')
    
    const pdfs = await res.json()
    
    countEl.textContent = `${pdfs.length} PDF${pdfs.length !== 1 ? 's' : ''}`
    
    if (pdfs.length === 0) {
      listEl.innerHTML = '<div class="empty">No PDF files found</div>'
      return
    }
    
    listEl.innerHTML = pdfs.map(pdf => `
      <a href="/view/${pdf.id}" class="pdf-item">
        <div class="pdf-info">
          <div class="pdf-filename">${escapeHtml(pdf.filename)}</div>
          <div class="pdf-meta">${pdf.pageCount} pages · ${formatSize(pdf.size)}</div>
        </div>
        <span class="pdf-arrow">→</span>
      </a>
    `).join('')
    
  } catch (err) {
    console.error('Failed to load PDF list:', err)
    listEl.innerHTML = '<div class="empty">Failed to load PDF list</div>'
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

loadPdfList()
```

**Step 4: Commit**

```bash
git add public/index.html public/js/list.js public/css/list.css
git commit -m "feat: add PDF library list page"
```

---

## Task 5: Convert Viewer to Standalone Page

**Files:**
- Rename: `public/index.html` → `public/view.html`
- Modify: `public/view.html`
- Modify: `public/js/app.js` → `public/js/viewer-app.js`

**Step 1: Rename and update viewer HTML**

Rename `public/index.html` to `public/view.html`, then update:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Viewer</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div id="app">
    <div id="toolbar">
      <div id="toolbar-left">
        <a href="/" id="back-btn" title="Back to Library">← Library</a>
        <button id="toggle-outline" title="Table of Contents" aria-pressed="false" style="display: none;">☰</button>
        <button id="zoom-out" title="Zoom Out">&minus;</button>
        <span id="zoom-level">100%</span>
        <button id="zoom-in" title="Zoom In">+</button>
        <button id="fit-width" title="Fit Width">Fit W</button>
        <button id="fit-page" title="Fit Page">Fit P</button>
        <button id="toggle-mode" title="Toggle page flip mode" aria-pressed="false">Paged</button>
      </div>
      <div id="toolbar-center">
        <span id="page-indicator">Loading...</span>
      </div>
      <div id="toolbar-right">
        <button id="toggle-autoscroll" title="Auto Scroll" aria-pressed="false">▶</button>
        <input type="range" id="autoscroll-speed" min="10" max="50" value="30" title="Scroll Speed">
        <span id="autoscroll-speed-value">30</span>
        <button id="reset" title="Reset View">Reset</button>
      </div>
    </div>

    <div id="viewport">
      <div id="outline-panel">
        <div id="outline-header">
          <span>Table of Contents</span>
          <button id="close-outline" title="Close">×</button>
        </div>
        <div id="outline-tree"></div>
      </div>
      <div id="page-container"></div>
    </div>
  </div>

  <script type="module" src="/js/viewer-app.js"></script>
</body>
</html>
```

**Step 2: Rename and update viewer app JS**

Rename `public/js/app.js` to `public/js/viewer-app.js`, then update:

```javascript
import { PdfViewer } from './viewer.js'
import { ViewerControls } from './controls.js'

function getPdfIdFromUrl() {
  const match = window.location.pathname.match(/^\/view\/([a-f0-9]{32})$/)
  return match ? match[1] : null
}

async function main() {
  const pdfId = getPdfIdFromUrl()
  
  if (!pdfId) {
    document.getElementById('page-indicator').textContent = 'Invalid PDF ID'
    return
  }

  const viewer = new PdfViewer('page-container', 'viewport')
  const controls = new ViewerControls(viewer)

  try {
    const info = await viewer.load(pdfId)
    document.title = `${info.filename || 'PDF Viewer'}`
    console.log(`Loaded PDF: ${info.pageCount} pages`)

    controls.init()
    controls.updatePageIndicator()
  } catch (err) {
    console.error('Failed to initialize PDF viewer:', err)
    document.getElementById('page-indicator').textContent = 'Error loading PDF'
  }
}

main()
```

**Step 3: Update CSS for back button**

Add to `public/css/style.css`:

```css
#back-btn {
  background: #4a4d50;
  border: 1px solid #5a5d60;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
}

#back-btn:hover {
  background: #5a5d60;
}
```

**Step 4: Delete old app.js**

```bash
rm public/js/app.js
```

**Step 5: Commit**

```bash
git add public/view.html public/js/viewer-app.js public/css/style.css
git rm public/index.html public/js/app.js
git commit -m "refactor: convert viewer to standalone page with URL routing"
```

---

## Task 6: Add Docker Support

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

**Step 1: Create Dockerfile**

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

**Step 2: Create docker-compose.yml**

```yaml
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

**Step 3: Create .dockerignore**

```
node_modules
pdfs
.git
*.md
*.png
outline-issue.png
gview-dummy.png
```

**Step 4: Update .gitignore**

Add to `.gitignore`:
```
pdfs/*.pdf
```

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore .gitignore
git commit -m "feat: add Docker deployment support"
```

---

## Task 7: Final Testing and Verification

**Step 1: Test the application**

```bash
npm start
```

Verify:
- `GET /` returns list page
- `GET /api/pdfs` returns JSON array
- `GET /view/<md5>` loads viewer with correct PDF
- Duplicate files are deduplicated

**Step 2: Commit any fixes**

---

## Summary

After all tasks:
1. ✅ PDF index service with MD5 deduplication
2. ✅ 30-minute periodic scanning
3. ✅ List page at `/`
4. ✅ Viewer page at `/view/:id`
5. ✅ Docker deployment ready