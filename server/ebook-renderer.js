import * as fs from 'node:fs'
import * as path from 'node:path'
import * as mupdf from 'mupdf'
import { LRUCache } from './cache.js'
import { getEbookById } from './ebook-index.js'
import { preprocessBuffer, isReflowable, isDirectRenderFormat, bufferToHtmlPages } from './html-sanitizer.js'

const imageCache = new LRUCache(100)
const docCache = new Map()
const textContentCache = new Map()

export function getTextContent(ebookId) {
  if (textContentCache.has(ebookId)) {
    return textContentCache.get(ebookId)
  }

  const entry = getEbookById(ebookId)
  if (!entry) return null

  const ext = path.extname(entry.filePath).toLowerCase()
  if (!isDirectRenderFormat(ext)) return null

  const rawBuffer = fs.readFileSync(entry.filePath)
  const result = bufferToHtmlPages(rawBuffer, ext)

  textContentCache.set(ebookId, result)
  return result
}

function getDocument(ebookId) {
  if (docCache.has(ebookId)) {
    return docCache.get(ebookId)
  }

  const entry = getEbookById(ebookId)
  if (!entry) {
    return null
  }

  const ext = path.extname(entry.filePath).toLowerCase()
  if (isDirectRenderFormat(ext)) return null

  const rawBuffer = fs.readFileSync(entry.filePath)
  const { buffer, magic } = preprocessBuffer(rawBuffer, ext)
  const doc = mupdf.Document.openDocument(buffer, magic)

  if (isReflowable(ext) && typeof doc.layout === 'function') {
    doc.layout(595, 842, 12)
  }

  docCache.set(ebookId, doc)
  return doc
}

export function getEbookInfo(ebookId) {
  const entry = getEbookById(ebookId)
  if (!entry) return null

  const ext = path.extname(entry.filePath).toLowerCase()

  if (isDirectRenderFormat(ext)) {
    const content = getTextContent(ebookId)
    if (!content) return null

    return {
      id: ebookId,
      filename: entry.name,
      pageCount: content.pages.length,
      pages: content.pages.map((_, i) => ({ index: i, width: 800, height: 1000 })),
      format: 'text',
    }
  }

  const doc = getDocument(ebookId)
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

  return {
    id: ebookId,
    filename: entry.name,
    pageCount,
    pages,
    format: 'image',
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

export function getEbookOutline(ebookId) {
  const doc = getDocument(ebookId)
  if (!doc) return []

  try {
    const outline = doc.loadOutline()
    if (!outline || outline.length === 0) return []
    return outline.map(item => normalizeOutlineItem(item, doc))
  } catch (err) {
    console.error(`Failed to load outline for ${ebookId}:`, err)
    return []
  }
}

const textCache = new LRUCache(200)

export function getPageText(ebookId, pageNum) {
  const cacheKey = `${ebookId}:${pageNum}:text`
  const cached = textCache.get(cacheKey)
  if (cached) return cached

  const doc = getDocument(ebookId)
  if (!doc) return null

  const pageCount = doc.countPages()
  const pageIndex = pageNum - 1
  if (pageIndex < 0 || pageIndex >= pageCount) return null

  const page = doc.loadPage(pageIndex)
  const bounds = page.getBounds()
  const stext = page.toStructuredText()
  const json = JSON.parse(stext.asJSON(1))

  const result = {
    width: bounds[2] - bounds[0],
    height: bounds[3] - bounds[1],
    blocks: json.blocks,
  }

  textCache.set(cacheKey, result)
  return result
}

export function renderPage(ebookId, pageNum, scale = 1.5) {
  if (scale < 0.5) scale = 0.5
  if (scale > 4.0) scale = 4.0

  const cacheKey = `${ebookId}:${pageNum}:${scale}`
  const cached = imageCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const doc = getDocument(ebookId)
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
