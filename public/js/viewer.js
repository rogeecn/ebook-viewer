const DEFAULT_SCALE = 1.5
const DISPLAY_WIDTH = 800

export class PdfViewer {
  constructor(containerId, viewportId) {
    this.container = document.getElementById(containerId)
    this.viewport = document.getElementById(viewportId)
    this.pdfId = null
    this.pdfInfo = null
    this.serverScale = DEFAULT_SCALE
    this.renderedPages = new Set()
    this.observer = null
  }

  async load(pdfId) {
    this.pdfId = pdfId
    this.renderedPages.clear()

    const res = await fetch(`/api/pdf/${pdfId}/info`)
    if (!res.ok) throw new Error(`Failed to load PDF: ${res.statusText}`)
    this.pdfInfo = await res.json()

    this.container.innerHTML = ''
    this.pdfInfo.pages.forEach((page, i) => {
      const wrapper = this.createPageWrapper(page, i + 1)
      this.container.appendChild(wrapper)
    })

    this.setupIntersectionObserver()

    return this.pdfInfo
  }

  createPageWrapper(pageInfo, pageNum) {
    const wrapper = document.createElement('div')
    wrapper.className = 'page-wrapper loading'
    wrapper.dataset.page = pageNum

    const aspectRatio = pageInfo.height / pageInfo.width
    const displayWidth = DISPLAY_WIDTH
    const displayHeight = Math.round(displayWidth * aspectRatio)

    wrapper.style.width = `${displayWidth}px`
    wrapper.style.height = `${displayHeight}px`

    const canvas = document.createElement('canvas')
    canvas.className = 'page-canvas'
    this.setupCanvas(canvas, displayWidth, displayHeight)

    wrapper.appendChild(canvas)
    return wrapper
  }

  setupCanvas(canvas, width, height) {
    const dpr = window.devicePixelRatio || 1
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }

  setupIntersectionObserver() {
    if (this.observer) {
      this.observer.disconnect()
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10)
            if (!this.renderedPages.has(pageNum)) {
              this.renderPage(entry.target, pageNum)
            }
          }
        })
      },
      {
        root: this.viewport,
        rootMargin: '300px',
      }
    )

    this.container.querySelectorAll('.page-wrapper').forEach((wrapper) => {
      this.observer.observe(wrapper)
    })
  }

  async renderPage(wrapper, pageNum) {
    this.renderedPages.add(pageNum)
    const canvas = wrapper.querySelector('canvas')
    const ctx = canvas.getContext('2d')

    try {
      const url = `/api/pdf/${this.pdfId}/page/${pageNum}?scale=${this.serverScale}`
      const img = new Image()
      img.src = url

      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      wrapper.classList.remove('loading')
    } catch (err) {
      console.error(`Failed to render page ${pageNum}:`, err)
    }
  }

  reRenderAll(newScale) {
    this.serverScale = newScale
    this.renderedPages.clear()
    this.setupIntersectionObserver()
  }

  getCurrentPage() {
    const wrappers = this.container.querySelectorAll('.page-wrapper')
    const viewportRect = this.viewport.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewportRect.height / 2

    let closestPage = 1
    let closestDistance = Infinity

    wrappers.forEach((wrapper) => {
      const rect = wrapper.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const distance = Math.abs(center - viewportCenter)
      if (distance < closestDistance) {
        closestDistance = distance
        closestPage = parseInt(wrapper.dataset.page, 10)
      }
    })

    return closestPage
  }

  get pageCount() {
    return this.pdfInfo ? this.pdfInfo.pageCount : 0
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect()
    }
    this.container.innerHTML = ''
    this.renderedPages.clear()
  }
}
