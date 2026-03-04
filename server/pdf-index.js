import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as mupdf from 'mupdf'

const PDF_DIR = process.env.PDF_DIR || path.resolve('pdfs')
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || '1800000', 10)

const index = new Map()
const pathToMd5 = new Map()
const fileMtimes = new Map()

/**
 * @typedef {Object} PdfEntry
 * @property {string} id - MD5 hash
 * @property {string} filename - Original filename
 * @property {number} pageCount - Number of pages
 * @property {number} size - File size in bytes
 * @property {string} filePath - Absolute file path
 */

function calculateMd5(filePath) {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function extractMetadata(filePath) {
  const buffer = fs.readFileSync(filePath)
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  try {
    const pageCount = doc.countPages()
    const stats = fs.statSync(filePath)
    return { pageCount, size: stats.size }
  } finally {
    doc.destroy()
  }
}

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
      const stats = fs.statSync(filePath)
      const existingMd5 = pathToMd5.get(filePath)
      const lastMtime = fileMtimes.get(filePath)
      
      if (existingMd5 && lastMtime && stats.mtimeMs === lastMtime) {
        newPaths.add(filePath)
        continue
      }
      
      const md5 = calculateMd5(filePath)
      fileMtimes.set(filePath, stats.mtimeMs)
      
      if (index.has(md5)) {
        skipped++
        newPaths.add(filePath)
        pathToMd5.set(filePath, md5)
        continue
      }
      
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
  
  for (const [oldPath, md5] of pathToMd5) {
    if (!newPaths.has(oldPath)) {
      const entry = index.get(md5)
      if (entry && entry.filePath === oldPath) {
        index.delete(md5)
        fileMtimes.delete(oldPath)
      }
      pathToMd5.delete(oldPath)
    }
  }
  
  console.log(`Scan complete: ${index.size} PDFs indexed (${added} added, ${skipped} duplicates skipped)`)
}

export function getAllPdfs() {
  return Array.from(index.values())
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

export function getPdfById(id) {
  return index.get(id) || null
}

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

scanDirectory()