import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as mupdf from 'mupdf'
import { loadCache, saveCacheAtomically, buildCacheData, getCachePath } from './ebook-cache.js'
import { isSupportedFile, getMimeType } from './formats.js'

const EBOOK_DIR = process.env.EBOOK_DIR || path.resolve('ebooks')
const SCAN_INTERVAL = parseInt(process.env.SCAN_INTERVAL || '1800000', 10)

/**
 * @typedef {Object} EbookEntry
 * @property {string} id - MD5 hash of relative path
 * @property {string} name - Filename (basename)
 * @property {string} relPath - Relative path from EBOOK_DIR (POSIX separators)
 * @property {string} dirPath - Directory path (parent folder, POSIX)
 * @property {number} pageCount - Number of pages
 * @property {number} size - File size in bytes
 * @property {number} mtimeMs - Last modified time in ms
 * @property {string} filePath - Absolute file path (server-only)
 */

/**
 * @typedef {Object} FolderSummary
 * @property {string} path - Folder path relative to EBOOK_DIR ("" for root)
 * @property {string} name - Folder name ("" for root)
 * @property {string[]} childFolders - Direct child folder names
 * @property {string[]} childEbookIds - Direct child ebook ids
 * @property {number} folderCount - Count of direct child folders
 * @property {number} ebookCount - Count of direct child ebooks
 * @property {number} totalEbookCount - Total ebooks in subtree
 */

/** @type {Map<string, EbookEntry>} */
const byId = new Map()

/** @type {Map<string, EbookEntry>} */
const byRelPath = new Map()

/** @type {Map<string, FolderSummary>} */
const folderIndex = new Map()

function normalizeRelPath(p) {
  return p.split(path.sep).join('/')
}

function getDirPath(relPath) {
  const parts = relPath.split('/')
  parts.pop()
  return parts.join('/')
}

function hashRelPath(relPath) {
  return crypto.createHash('md5').update(relPath).digest('hex')
}

function extractMetadata(filePath) {
  const buffer = fs.readFileSync(filePath)
  const magic = getMimeType(filePath)
  const doc = mupdf.Document.openDocument(buffer, magic)
  try {
    const pageCount = doc.countPages()
    const stats = fs.statSync(filePath)
    return { pageCount, size: stats.size, mtimeMs: stats.mtimeMs }
  } finally {
    doc.destroy()
  }
}

function ensureFolderExists(folderPath) {
  if (folderIndex.has(folderPath)) return
  
  const parts = folderPath.split('/').filter(Boolean)
  const name = parts.length > 0 ? parts[parts.length - 1] : ''
  
  folderIndex.set(folderPath, {
    path: folderPath,
    name,
    childFolders: [],
    childEbookIds: [],
    folderCount: 0,
    ebookCount: 0,
    totalEbookCount: 0
  })
  
  if (parts.length > 1) {
    const parentPath = parts.slice(0, -1).join('/')
    ensureFolderExists(parentPath)
  }
}

function updateFolderRelationships() {
  for (const folder of folderIndex.values()) {
    folder.childFolders = []
    folder.childEbookIds = []
    folder.folderCount = 0
    folder.ebookCount = 0
  }
  
  for (const entry of byId.values()) {
    const parentPath = entry.dirPath
    ensureFolderExists(parentPath)
    const folder = folderIndex.get(parentPath)
    if (folder) {
      folder.childEbookIds.push(entry.id)
      folder.ebookCount++
    }
  }
  
  for (const [folderPath, folder] of folderIndex) {
    if (folderPath === '') continue
    
    const parts = folderPath.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    ensureFolderExists(parentPath)
    const parent = folderIndex.get(parentPath)
    if (parent) {
      parent.childFolders.push(folder.name)
      parent.folderCount++
    }
  }
  
  function calculateTotals(folderPath) {
    const folder = folderIndex.get(folderPath)
    if (!folder) return 0
    
    let total = folder.ebookCount
    
    for (const childName of folder.childFolders) {
      const childPath = folderPath ? `${folderPath}/${childName}` : childName
      total += calculateTotals(childPath)
    }
    
    folder.totalEbookCount = total
    return total
  }
  
  ensureFolderExists('')
  calculateTotals('')
}

export function scanDirectoryRecursive() {
  console.log(`Scanning document directory recursively: ${EBOOK_DIR}`)
  
  if (!fs.existsSync(EBOOK_DIR)) {
    console.warn(`Ebook directory does not exist: ${EBOOK_DIR}, creating...`)
    fs.mkdirSync(EBOOK_DIR, { recursive: true })
    return
  }
  
  const seenRelPaths = new Set()
  let added = 0
  let updated = 0
  let skipped = 0
  
  const stack = [{ absDir: EBOOK_DIR, relDir: '' }]
  
  while (stack.length > 0) {
    const { absDir, relDir } = stack.pop()
    
    let entries
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch (err) {
      console.error(`Failed to read directory ${absDir}:`, err.message)
      continue
    }
    
    for (const entry of entries) {
      const name = entry.name
      const absPath = path.join(absDir, name)
      const relPath = relDir ? `${relDir}/${name}` : name
      
      if (entry.isDirectory()) {
        stack.push({ absDir: absPath, relDir: relPath })
      } else if (entry.isFile() && isSupportedFile(name)) {
        const normalizedRelPath = normalizeRelPath(relPath)
        seenRelPaths.add(normalizedRelPath)
        
        try {
          const stats = fs.statSync(absPath)
          const existing = byRelPath.get(normalizedRelPath)
          
          if (existing && existing.mtimeMs === stats.mtimeMs && existing.size === stats.size) {
            skipped++
            continue
          }
          
          const metadata = extractMetadata(absPath)
          const id = hashRelPath(normalizedRelPath)
          
          const ebookEntry = {
            id,
            name,
            relPath: normalizedRelPath,
            dirPath: getDirPath(normalizedRelPath),
            pageCount: metadata.pageCount,
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
            filePath: absPath
          }
          
          if (existing && existing.id !== id) {
            byId.delete(existing.id)
          }
          
          byId.set(id, ebookEntry)
          byRelPath.set(normalizedRelPath, ebookEntry)
          
          if (existing) {
            updated++
          } else {
            added++
          }
          
        } catch (err) {
          console.error(`Failed to process ${name}:`, err.message)
        }
      }
    }
  }
  
  let removed = 0
  for (const [relPath, entry] of byRelPath) {
    if (!seenRelPaths.has(relPath)) {
      byId.delete(entry.id)
      byRelPath.delete(relPath)
      removed++
    }
  }
  
  folderIndex.clear()
  ensureFolderExists('')
  updateFolderRelationships()
  
  console.log(`Scan complete: ${byId.size} documents indexed (${added} added, ${updated} updated, ${skipped} unchanged, ${removed} removed)`)
}

export function getAllEbooks() {
  return Array.from(byId.values())
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export function getEbookById(id) {
  return byId.get(id) || null
}

export function getEbookByRelPath(relPath) {
  return byRelPath.get(relPath) || null
}

/**
 * Get folder node for tree API
 * @param {string} folderPath - Folder path ("" for root)
 * @param {Object} opts - Options
 * @param {number} opts.limitFolders - Max folders to return
 * @param {number} opts.limitEbooks - Max ebooks to return
 */
export function getFolderNode(folderPath, {
  limitFolders = 200,
  limitEbooks = 200
} = {}) {
  const folder = folderIndex.get(folderPath)
  if (!folder) return null
  
  const childFolders = folder.childFolders.slice(0, limitFolders)
  const childEbookIds = folder.childEbookIds.slice(0, limitEbooks)
  
  const hasMoreFolders = folder.childFolders.length > limitFolders
  const hasMoreEbooks = folder.childEbookIds.length > limitEbooks
  
  const folders = childFolders.map(name => {
    const childPath = folderPath ? `${folderPath}/${name}` : name
    const childFolder = folderIndex.get(childPath)
    return {
      type: 'folder',
      path: childPath,
      name,
      counts: {
        folders: childFolder?.folderCount || 0,
        ebooks: childFolder?.ebookCount || 0,
        totalEbooks: childFolder?.totalEbookCount || 0
      },
      hasChildren: (childFolder?.folderCount || 0) > 0 || (childFolder?.ebookCount || 0) > 0,
      loaded: false
    }
  })
  
  // Build ebook nodes
  const ebooks = childEbookIds.map(id => {
    const entry = byId.get(id)
    if (!entry) return null
    return {
      type: 'ebook',
      id: entry.id,
      name: entry.name,
      relPath: entry.relPath,
      dirPath: entry.dirPath,
      pageCount: entry.pageCount,
      size: entry.size,
      mtimeMs: entry.mtimeMs
    }
  }).filter(Boolean)
  
  return {
    type: 'folder',
    path: folderPath,
    name: folder.name || 'Root',
    counts: {
      folders: folder.folderCount,
      ebooks: folder.ebookCount,
      totalEbooks: folder.totalEbookCount
    },
    children: {
      folders,
      ebooks
    },
    hasMore: {
      folders: hasMoreFolders,
      ebooks: hasMoreEbooks
    },
    loaded: true
  }
}

/**
 * Search ebooks by filename
 * @param {string} query - Search query
 * @param {Object} opts - Options
 * @param {number} opts.limit - Max results
 */
export function listSearchResults(query, {
  limit = 200
} = {}) {
  if (!query || query.trim() === '') {
    return []
  }
  
  const lowerQuery = query.toLowerCase()
  const results = []
  
  for (const entry of byId.values()) {
    const nameLower = entry.name.toLowerCase()
    const relPathLower = entry.relPath.toLowerCase()
    
    if (nameLower.includes(lowerQuery) || relPathLower.includes(lowerQuery)) {
      const nameIndex = nameLower.indexOf(lowerQuery)
      const pathIndex = relPathLower.indexOf(lowerQuery)
      
      let score = 1000
      if (nameIndex >= 0) {
        score = nameIndex
      } else if (pathIndex >= 0) {
        score = 500 + pathIndex
      }
      
      results.push({
        id: entry.id,
        name: entry.name,
        relPath: entry.relPath,
        dirPath: entry.dirPath,
        pageCount: entry.pageCount,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        score
      })
    }
  }
  
  results.sort((a, b) => a.score - b.score)
  
  return results.slice(0, limit)
}

/**
 * Get multiple ebooks by IDs
 * @param {string[]} ids - Array of ebook IDs
 */
export function getEbooksByIds(ids) {
  return ids
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(entry => ({
      id: entry.id,
      name: entry.name,
      relPath: entry.relPath,
      dirPath: entry.dirPath,
      pageCount: entry.pageCount,
      size: entry.size,
      mtimeMs: entry.mtimeMs
    }))
}

export function startPeriodicScan() {
  const cachePath = getCachePath()
  const cached = loadCache(cachePath, EBOOK_DIR)
  
  if (cached) {
    for (const ebook of cached.ebooks) {
      const entry = {
        ...ebook,
        filePath: path.join(EBOOK_DIR, ebook.relPath)
      }
      byId.set(entry.id, entry)
      byRelPath.set(entry.relPath, entry)
    }
    
    for (const folder of cached.folders) {
      folderIndex.set(folder.path, folder)
    }
    
    console.log(`Loaded cache: ${byId.size} documents, ${folderIndex.size} folders`)
    
    setTimeout(() => {
      try {
        scanDirectoryRecursive()
        const cacheData = buildCacheData(byId, folderIndex, EBOOK_DIR)
        saveCacheAtomically(cachePath, cacheData)
      } catch (err) {
        console.error('Background sync failed:', err)
      }
    }, 100)
  } else {
    scanDirectoryRecursive()
    const cacheData = buildCacheData(byId, folderIndex, EBOOK_DIR)
    saveCacheAtomically(cachePath, cacheData)
  }
  
  setInterval(() => {
    try {
      scanDirectoryRecursive()
      const cacheData = buildCacheData(byId, folderIndex, EBOOK_DIR)
      saveCacheAtomically(cachePath, cacheData)
    } catch (err) {
      console.error('Periodic scan failed:', err)
    }
  }, SCAN_INTERVAL)
  
  console.log(`Periodic scanning enabled: every ${SCAN_INTERVAL / 1000 / 60} minutes`)
}

ensureFolderExists('')