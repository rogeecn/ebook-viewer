const ROW_HEIGHT = 52
const RECENTS_KEY = 'ebookLibrary.recents.v1'
const MAX_RECENTS = 10

const folderStore = new Map()
const expandedFolders = new Set()
let visibleRows = []
let searchQuery = ''
let isSearchMode = false
let searchResults = []
let rootLoaded = false
let progressData = {}

const viewport = document.getElementById('tree-viewport')
const topSpacer = document.getElementById('top-spacer')
const bottomSpacer = document.getElementById('bottom-spacer')
const visibleRowsEl = document.getElementById('visible-rows')
const loadingOverlay = document.getElementById('loading-overlay')
const searchInput = document.getElementById('search-input')
const searchClear = document.getElementById('search-clear')
const ebookCount = document.getElementById('ebook-count')
const recentSection = document.getElementById('recent-section')
const recentList = document.getElementById('recent-list')
const refreshBtn = document.getElementById('refresh-btn')

let refreshCooldownTimer = null
const REFRESH_COOLDOWN = 10000

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
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

function formatTimeAgo(ms) {
  if (!ms || typeof ms !== 'number' || isNaN(ms)) return 'Unknown'
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago'
  return new Date(ms).toLocaleDateString()
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text)
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)
  if (index === -1) return escapeHtml(text)
  
  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)
  
  return escapeHtml(before) + '<span class="search-highlight">' + escapeHtml(match) + '</span>' + escapeHtml(after)
}

const PINS_KEY = 'ebookLibrary.pins.v1'
const MAX_PINS = 3

function getPins() {
  try {
    const data = localStorage.getItem(PINS_KEY)
    if (!data) return []
    return JSON.parse(data).filter(p => p && p.id && p.name && p.pinnedAt)
  } catch {
    return []
  }
}

function savePins(pins) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins))
  } catch {}
}

function isPinned(ebookId) {
  return getPins().some(p => p.id === ebookId)
}

function togglePin(ebookId) {
  let pins = getPins()
  if (isPinned(ebookId)) {
    pins = pins.filter(p => p.id !== ebookId)
  } else {
    if (pins.length >= MAX_PINS) return
    const recents = getRecents()
    const ebook = recents.find(r => r.id === ebookId)
    if (ebook) {
      pins.unshift({
        id: ebook.id,
        name: ebook.name,
        relPath: ebook.relPath,
        pinnedAt: Date.now()
      })
    }
  }
  savePins(pins)
}

function getRecents() {
  try {
    const data = localStorage.getItem(RECENTS_KEY)
    if (!data) return []
    const parsed = JSON.parse(data)
    return parsed.filter(r => r && r.id && r.name && typeof r.lastOpenedAt === 'number' && r.lastOpenedAt > 0)
  } catch {
    return []
  }
}

function saveRecents(recents) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
  } catch {}
}

function addRecent(entry) {
  let recents = getRecents()
  const existing = recents.find(r => r.id === entry.id)
  
  if (existing) {
    existing.lastOpenedAt = Date.now()
    if (!isPinned(entry.id)) {
      recents = recents.filter(r => r.id !== entry.id)
      recents.unshift(existing)
    }
  } else {
    recents.unshift({
      id: entry.id,
      name: entry.name,
      relPath: entry.relPath,
      lastOpenedAt: Date.now()
    })
  }

  if (recents.length > MAX_RECENTS) {
    const pinnedIds = new Set(getPins().map(p => p.id))
    const toKeep = recents.filter(r => pinnedIds.has(r.id))
    const others = recents.filter(r => !pinnedIds.has(r.id))
    recents = [...toKeep, ...others].slice(0, MAX_RECENTS)
  }

  saveRecents(recents)
  renderRecents()
}

function clearRecents() {
  const pinnedIds = new Set(getPins().map(p => p.id))
  const recents = getRecents().filter(r => pinnedIds.has(r.id))
  saveRecents(recents)
  renderRecents()
}

function renderRecents() {
  const pins = getPins()
  const allRecents = getRecents()
  const recentsById = new Map(allRecents.map(r => [r.id, r]))
  const unpinnedRecents = allRecents.filter(r => !isPinned(r.id))
  
  pins.sort((a, b) => a.pinnedAt - b.pinnedAt)
  unpinnedRecents.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  
  const pinnedDisplay = pins.map(p => {
    const recent = recentsById.get(p.id)
    return { ...p, lastOpenedAt: recent?.lastOpenedAt || null }
  })
  
  const displayItems = [...pinnedDisplay, ...unpinnedRecents]
  
  if (displayItems.length === 0) {
    recentSection.style.display = 'none'
    return
  }
  
  recentSection.style.display = 'block'
  recentList.innerHTML = displayItems.map(item => {
    const isItemPinned = isPinned(item.id)
    const pinIcon = isItemPinned 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1l.784-.784A1 1 0 0 0 17 2.5v0a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v0a1 1 0 0 0 .216.63L8 4a1 1 0 0 1 1 1z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1l.784-.784A1 1 0 0 0 17 2.5v0a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v0a1 1 0 0 0 .216.63L8 4a1 1 0 0 1 1 1z"/></svg>'
      
    const timeText = item.lastOpenedAt ? formatTimeAgo(item.lastOpenedAt) : (isItemPinned ? 'Pinned' : '')
    const progress = progressData[item.id]
    const progressText = progress?.page > 1 ? ` · p.${progress.page}` : ''
    
    return `
    <a href="/view/${item.id}" class="recent-item ${isItemPinned ? 'pinned' : ''}" data-ebook-id="${item.id}">
      <div class="recent-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </div>
      <div class="recent-info">
        <div class="recent-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="recent-meta">${timeText}${progressText}</div>
      </div>
      <button class="recent-pin-btn" data-pin-id="${item.id}" title="${isItemPinned ? 'Unpin' : 'Pin'}">
        ${pinIcon}
      </button>
    </a>
  `}).join('')
  
  recentList.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.recent-pin-btn')) return
      
      const id = el.dataset.ebookId
      const recents = getRecents()
      const entry = recents.find(r => r.id === id) || getPins().find(p => p.id === id)
      if (entry) addRecent(entry)
    })
  })
  
  recentList.querySelectorAll('.recent-pin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const id = btn.dataset.pinId
      togglePin(id)
      renderRecents()
    })
  })
}

async function fetchAllProgress() {
  try {
    const res = await fetch('/api/progress')
    if (res.ok) {
      progressData = await res.json()
    }
  } catch {}
}

async function fetchRoot() {
  showLoading(true)
  try {
    const res = await fetch('/api/tree')
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    folderStore.set('', data)
    rootLoaded = true
    updateEbookCount()
    computeVisibleRows()
    render()
  } catch (err) {
    console.error('Failed to load tree:', err)
    visibleRowsEl.innerHTML = '<div class="empty-state"><h3>Error loading ebooks</h3><p>Please refresh the page</p></div>'
  } finally {
    showLoading(false)
  }
}

async function fetchFolder(folderPath) {
  try {
    const url = folderPath ? `/api/tree/${encodeURIComponent(folderPath)}` : '/api/tree'
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to load folder')
    const data = await res.json()
    folderStore.set(folderPath, data)
    return data
  } catch (err) {
    console.error(`Failed to load folder ${folderPath}:`, err)
    return null
  }
}

async function performSearch(query) {
  if (!query || query.trim() === '') {
    exitSearch()
    return
  }
  
  searchQuery = query.trim()
  isSearchMode = true
  showLoading(true)
  
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=500`)
    if (!res.ok) throw new Error('Search failed')
    const data = await res.json()
    searchResults = data.results || []
    computeVisibleRows()
    render()
    updateEbookCount()
  } catch (err) {
    console.error('Search failed:', err)
    searchResults = []
  } finally {
    showLoading(false)
  }
}

function exitSearch() {
  isSearchMode = false
  searchQuery = ''
  searchResults = []
  searchInput.value = ''
  searchClear.style.display = 'none'
  computeVisibleRows()
  render()
  updateEbookCount()
}

function toggleFolder(folderPath) {
  if (expandedFolders.has(folderPath)) {
    expandedFolders.delete(folderPath)
  } else {
    expandedFolders.add(folderPath)
  }
  computeVisibleRows()
  render()
}

async function expandFolder(folderPath) {
  if (expandedFolders.has(folderPath)) {
    expandedFolders.delete(folderPath)
    computeVisibleRows()
    render()
    return
  }
  
  const folder = folderStore.get(folderPath)
  if (!folder || !folder.loaded) {
    showLoading(true)
    await fetchFolder(folderPath)
    showLoading(false)
  }
  
  expandedFolders.add(folderPath)
  computeVisibleRows()
  render()
}

function getFileExtension(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function getFileTypeIcon(name) {
  const ext = getFileExtension(name)
  switch (ext) {
    case '.pdf':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12h1.5a1.5 1.5 0 1 1 0 3H10v3"/><path d="M16 12v6"/></svg>', cls: 'icon-pdf' }
    case '.epub':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>', cls: 'icon-epub' }
    case '.mobi':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="12" y1="7" x2="12" y2="13"/></svg>', cls: 'icon-mobi' }
    case '.cbz':
    case '.cbt':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', cls: 'icon-comic' }
    case '.fb2':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>', cls: 'icon-fb2' }
    case '.xps':
    case '.oxps':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', cls: 'icon-xps' }
    case '.html':
    case '.xhtml':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>', cls: 'icon-html' }
    case '.md':
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>', cls: 'icon-md' }
    default:
      return { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', cls: 'icon-default' }
  }
}

function computeVisibleRows() {
  visibleRows = []
  
  if (isSearchMode) {
    searchResults.forEach(ebook => {
      visibleRows.push({
        type: 'ebook',
        data: ebook,
        depth: 0,
        isSearchResult: true
      })
    })
    return
  }
  
  function addFolderRows(folderPath, depth) {
    const folder = folderStore.get(folderPath)
    if (!folder || !folder.children) return
    
    folder.children.folders.forEach(childFolder => {
      visibleRows.push({
        type: 'folder',
        data: childFolder,
        depth,
        isExpanded: expandedFolders.has(childFolder.path)
      })
      
      if (expandedFolders.has(childFolder.path)) {
        addFolderRows(childFolder.path, depth + 1)
      }
    })
    
    folder.children.ebooks.forEach(ebook => {
      visibleRows.push({
        type: 'ebook',
        data: ebook,
        depth
      })
    })
  }
  
  if (rootLoaded) {
    addFolderRows('', 0)
  }
}

function render() {
  const scrollTop = viewport.scrollTop
  const viewportHeight = viewport.clientHeight
  
  const totalHeight = visibleRows.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10)
  const endIndex = Math.min(visibleRows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 10)
  
  topSpacer.style.height = startIndex * ROW_HEIGHT + 'px'
  bottomSpacer.style.height = (totalHeight - endIndex * ROW_HEIGHT) + 'px'
  
  const rows = visibleRows.slice(startIndex, endIndex)
  let html = ''
  
  rows.forEach((row, i) => {
    const top = (startIndex + i) * ROW_HEIGHT
    
    if (row.type === 'folder') {
      const hasChildren = row.data.hasChildren
      const isExpanded = row.isExpanded
      
      html += `
        <div class="tree-row folder-row ${isExpanded ? 'expanded' : ''}" 
             style="position: absolute; top: ${top}px; width: 100%;" 
             data-folder-path="${escapeHtml(row.data.path)}">
          <div class="row-indent" style="width: ${row.depth * 20}px;">
            ${Array(row.depth).fill('<span class="indent-unit"></span>').join('')}
          </div>
          <span class="folder-toggle ${isExpanded ? 'expanded' : ''} ${hasChildren ? '' : 'empty'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </span>
          <span class="row-icon folder-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          </span>
          <div class="row-content">
            <div class="row-name">${escapeHtml(row.data.name)}</div>
            <div class="row-counts">${row.data.counts?.totalEbooks || 0} docs</div>
          </div>
        </div>
      `
    } else {
      const ebook = row.data
      const nameClass = row.isSearchResult ? 'row-name search-match' : 'row-name'
      const displayName = row.isSearchResult ? highlightMatch(ebook.name, searchQuery) : escapeHtml(ebook.name)
      const fileType = getFileTypeIcon(ebook.name)
      
      html += `
        <a class="tree-row ebook-row" 
           style="position: absolute; top: ${top}px; width: 100%;" 
           href="/view/${ebook.id}" 
           data-ebook-id="${ebook.id}"
           data-ebook-name="${escapeHtml(ebook.name)}"
           data-ebook-rel-path="${escapeHtml(ebook.relPath || '')}">
          <div class="row-indent" style="width: ${row.depth * 20}px;">
            ${Array(row.depth).fill('<span class="indent-unit"></span>').join('')}
          </div>
          <span class="folder-toggle empty"></span>
          <span class="row-icon ebook-icon ${fileType.cls}">
            ${fileType.icon}
          </span>
          <div class="row-content">
            <div class="${nameClass}">${displayName}</div>
            <div class="row-meta">${ebook.pageCount || 0} pages · ${formatSize(ebook.size || 0)}</div>
          </div>
        </a>
      `
    }
  })
  
  visibleRowsEl.innerHTML = html
  
  visibleRowsEl.querySelectorAll('.folder-row').forEach(el => {
    el.addEventListener('click', () => {
      const folderPath = el.dataset.folderPath
      expandFolder(folderPath)
    })
  })
  
  visibleRowsEl.querySelectorAll('.ebook-row').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.ebookId
      const name = el.dataset.ebookName
      const relPath = el.dataset.ebookRelPath
      addRecent({ id, name, relPath })
    })
  })
}

function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show)
}

function updateEbookCount() {
  if (isSearchMode) {
    ebookCount.textContent = `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`
  } else {
    const root = folderStore.get('')
    const total = root?.counts?.totalEbooks || 0
    ebookCount.textContent = `${total} document${total !== 1 ? 's' : ''}`
  }
}

function handleScroll() {
  requestAnimationFrame(render)
}

function handleSearchInput(e) {
  const query = e.target.value
  searchClear.style.display = query ? 'block' : 'none'
  debounce(performSearch, 200)(query)
}

async function handleRefresh() {
  if (refreshBtn.disabled) return

  refreshBtn.disabled = true
  refreshBtn.classList.add('refreshing')

  try {
    const res = await fetch('/api/rescan', { method: 'POST' })
    const data = await res.json()

    if (res.status === 429) {
      startRefreshCooldown(data.retryAfter * 1000)
      return
    }

    folderStore.clear()
    expandedFolders.clear()
    rootLoaded = false
    await fetchRoot()
  } catch (err) {
    console.error('Refresh failed:', err)
  } finally {
    refreshBtn.classList.remove('refreshing')
    startRefreshCooldown(REFRESH_COOLDOWN)
  }
}

function startRefreshCooldown(ms) {
  refreshBtn.disabled = true
  clearTimeout(refreshCooldownTimer)
  refreshCooldownTimer = setTimeout(() => {
    refreshBtn.disabled = false
  }, ms)
}

async function init() {
  viewport.addEventListener('scroll', handleScroll, { passive: true })
  searchInput.addEventListener('input', handleSearchInput)
  searchClear.addEventListener('click', () => {
    searchInput.value = ''
    searchClear.style.display = 'none'
    exitSearch()
  })
  document.getElementById('clear-recents').addEventListener('click', clearRecents)
  refreshBtn.addEventListener('click', handleRefresh)
  
  await fetchAllProgress()
  renderRecents()
  fetchRoot()
}

init()