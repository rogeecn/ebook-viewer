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