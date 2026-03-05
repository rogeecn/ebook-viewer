import { EbookViewer } from './viewer.js'
import { ViewerControls } from './controls.js'

const RECENTS_KEY = 'ebookLibrary.recents.v1'
const MAX_RECENTS = 10
const PROGRESS_SAVE_DEBOUNCE_MS = 1000

function getEbookIdFromUrl() {
  const match = window.location.pathname.match(/^\/view\/([a-f0-9]{32})$/)
  return match ? match[1] : null
}

function getRecents() {
  try {
    const data = localStorage.getItem(RECENTS_KEY)
    return data ? JSON.parse(data) : []
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
  const recents = getRecents().filter(r => r.id !== entry.id)
  recents.unshift({
    id: entry.id,
    name: entry.name,
    relPath: entry.relPath || '',
    lastOpenedAt: Date.now(),
    lastPage: 1
  })
  saveRecents(recents.slice(0, MAX_RECENTS))
}

function updateRecentPage(ebookId, page) {
  const recents = getRecents()
  const recent = recents.find(r => r.id === ebookId)
  if (recent) {
    recent.lastPage = page
    saveRecents(recents)
  }
}

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function saveProgressToServer(ebookId, page) {
  fetch(`/api/progress/${ebookId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page })
  }).catch(err => console.error('Failed to save progress:', err))
}

const debouncedSaveProgress = debounce(saveProgressToServer, PROGRESS_SAVE_DEBOUNCE_MS)

async function fetchSavedProgress(ebookId) {
  try {
    const res = await fetch(`/api/progress/${ebookId}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.page || null
  } catch {
    return null
  }
}

async function main() {
  const ebookId = getEbookIdFromUrl()
  
  if (!ebookId) {
    document.getElementById('page-indicator').textContent = 'Invalid ebook ID'
    return
  }

  const viewer = new EbookViewer('page-container', 'viewport')
  const controls = new ViewerControls(viewer)

  try {
    const info = await viewer.load(ebookId)
    document.title = `${info.filename || 'Ebook Viewer'}`
    console.log(`Loaded ebook: ${info.pageCount} pages`)

    addRecent({
      id: ebookId,
      name: info.filename || 'Unknown'
    })

    const container = document.getElementById('page-container')
    container.addEventListener('viewer:pageChange', (e) => {
      updateRecentPage(ebookId, e.detail.page)
      debouncedSaveProgress(ebookId, e.detail.page)
    })

    controls.init()
    controls.updatePageIndicator()

    const savedPage = await fetchSavedProgress(ebookId)
    if (savedPage && savedPage > 1 && savedPage <= info.pageCount) {
      viewer.navigateToPage(savedPage)
    }

    const viewport = document.getElementById('viewport')
    let lastTrackedPage = savedPage || 1
    viewport.addEventListener('scroll', () => {
      const currentPage = viewer.getCurrentPage()
      if (currentPage !== lastTrackedPage) {
        lastTrackedPage = currentPage
        updateRecentPage(ebookId, currentPage)
        debouncedSaveProgress(ebookId, currentPage)
      }
    }, { passive: true })
  } catch (err) {
    console.error('Failed to initialize ebook viewer:', err)
    document.getElementById('page-indicator').textContent = 'Error loading ebook'
  }
}

main()
