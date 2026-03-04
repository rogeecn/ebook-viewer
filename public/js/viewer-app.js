import { PdfViewer } from './viewer.js'
import { ViewerControls } from './controls.js'

const RECENTS_KEY = 'pdfLibrary.recents.v1'
const MAX_RECENTS = 10

function getPdfIdFromUrl() {
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

function addRecent(pdf) {
  const recents = getRecents().filter(r => r.id !== pdf.id)
  recents.unshift({
    id: pdf.id,
    name: pdf.name,
    relPath: pdf.relPath || '',
    lastOpenedAt: Date.now(),
    lastPage: 1
  })
  saveRecents(recents.slice(0, MAX_RECENTS))
}

function updateRecentPage(pdfId, page) {
  const recents = getRecents()
  const recent = recents.find(r => r.id === pdfId)
  if (recent) {
    recent.lastPage = page
    saveRecents(recents)
  }
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

    addRecent({
      id: pdfId,
      name: info.filename || 'Unknown'
    })

    const container = document.getElementById('page-container')
    container.addEventListener('viewer:pageChange', (e) => {
      updateRecentPage(pdfId, e.detail.page)
    })

    controls.init()
    controls.updatePageIndicator()
  } catch (err) {
    console.error('Failed to initialize PDF viewer:', err)
    document.getElementById('page-indicator').textContent = 'Error loading PDF'
  }
}

main()