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
