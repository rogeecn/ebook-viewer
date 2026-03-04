import { PdfViewer } from './viewer.js'
import { ViewerControls } from './controls.js'

const PDF_ID = 'test-bookmark'

async function main() {
  const viewer = new PdfViewer('page-container', 'viewport')
  const controls = new ViewerControls(viewer)

  try {
    const info = await viewer.load(PDF_ID)
    console.log(`Loaded PDF: ${info.pageCount} pages`)

    controls.init()
    controls.updatePageIndicator()
  } catch (err) {
    console.error('Failed to initialize PDF viewer:', err)
    document.getElementById('page-indicator').textContent = 'Error loading PDF'
  }
}

main()
