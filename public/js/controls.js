import Panzoom from '/js/vendor/panzoom.es.js'

const SWIPE_MIN_PX = 40
const SWIPE_MAX_MS = 600

export class ViewerControls {
  constructor(viewer) {
    this.viewer = viewer
    this.panzoom = null
    this.currentZoom = 1.0
    this.currentQualityTier = 1

    this.viewport = document.getElementById('viewport')
    this.container = document.getElementById('page-container')
    this.zoomInBtn = document.getElementById('zoom-in')
    this.zoomOutBtn = document.getElementById('zoom-out')
    this.fitWidthBtn = document.getElementById('fit-width')
    this.fitPageBtn = document.getElementById('fit-page')
    this.resetBtn = document.getElementById('reset')
    this.zoomLevel = document.getElementById('zoom-level')
    this.pageIndicator = document.getElementById('page-indicator')
    this.toggleModeBtn = document.getElementById('toggle-mode')

    this.swipeStartX = 0
    this.swipeStartY = 0
    this.swipeStartTime = 0

    this.isAutoScrolling = false
    this.autoScrollSpeedPps = 30
    this.autoScrollRafId = null
    this.autoScrollLastTs = null
  }

  getQualityTier(zoom) {
    if (zoom <= 1.0) return 1
    if (zoom <= 1.5) return 1.5
    if (zoom <= 2.0) return 2
    if (zoom <= 3.0) return 3
    return 4
  }

  init() {
    this.setupPanzoom()
    this.bindToolbarEvents()
    this.bindScrollEvents()
    this.bindModeEvents()
    this.bindKeyboardEvents()
    this.bindSwipeEvents()
    this.bindViewerEvents()
    this.bindAutoScrollEvents()
    this.updateZoomDisplay()
    this.updateAutoScrollButton()
    this.updateAutoScrollSpeedDisplay()
  }

  setupPanzoom() {
    this.panzoom = Panzoom(this.container, {
      maxScale: 5,
      minScale: 0.5,
      step: 0.15,
      cursor: 'default',
      animate: true,
      duration: 200,
      overflow: 'auto',
      touchAction: 'auto',
      panOnlyWhenZoomed: true,
    })

    this.viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        this.panzoom.zoomWithWheel(e)
        this.onZoomChange()
      }
    }, { passive: false })

    this.container.addEventListener('panzoomchange', () => {
      this.onZoomChange()
    })
  }

  bindToolbarEvents() {
    this.zoomInBtn.addEventListener('click', () => {
      this.panzoom.zoomIn()
      this.onZoomChange()
    })

    this.zoomOutBtn.addEventListener('click', () => {
      this.panzoom.zoomOut()
      this.onZoomChange()
    })

    this.fitWidthBtn.addEventListener('click', () => {
      const viewportWidth = this.viewport.clientWidth - 40
      const containerWidth = this.container.scrollWidth
      const targetScale = viewportWidth / containerWidth
      this.panzoom.zoom(targetScale, { animate: true })
      this.panzoom.pan(0, 0, { animate: true })
      this.onZoomChange()
    })

    this.fitPageBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })

    this.resetBtn.addEventListener('click', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })
  }

  bindScrollEvents() {
    this.viewport.addEventListener('scroll', () => {
      if (this.viewer.displayMode === 'vertical') {
        this.updatePageIndicator()
      }
    })
  }

bindModeEvents() {
    this.toggleModeBtn.addEventListener('click', () => {
      const newMode = this.viewer.displayMode === 'vertical' ? 'horizontal' : 'vertical'
      
      if (this.isAutoScrolling && newMode === 'horizontal') {
        this.stopAutoScroll()
      }
      
      this.viewer.setDisplayMode(newMode)
      this.updateModeButton()
      this.updatePanzoomForMode(newMode)
      this.updatePageIndicator()
      this.updateAutoScrollButton()
    })
  }

  bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      if (this.viewer.displayMode !== 'horizontal') return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        this.viewer.goToPage(this.viewer.currentPage - 1)
        this.updatePageIndicator()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        this.viewer.goToPage(this.viewer.currentPage + 1)
        this.updatePageIndicator()
      }
    })
  }

  bindSwipeEvents() {
    this.viewport.addEventListener('pointerdown', (e) => {
      if (this.viewer.displayMode !== 'horizontal') return

      this.swipeStartX = e.clientX
      this.swipeStartY = e.clientY
      this.swipeStartTime = Date.now()
      this.viewport.setPointerCapture(e.pointerId)
    })

    this.viewport.addEventListener('pointerup', (e) => {
      if (this.viewer.displayMode !== 'horizontal') return
      if (this.swipeStartTime === 0) return

      const dx = e.clientX - this.swipeStartX
      const dy = e.clientY - this.swipeStartY
      const dt = Date.now() - this.swipeStartTime

      this.swipeStartTime = 0

      if (dt > SWIPE_MAX_MS) return
      if (Math.abs(dy) > Math.abs(dx)) return
      if (Math.abs(dx) < SWIPE_MIN_PX) return

      if (dx < 0) {
        this.viewer.goToPage(this.viewer.currentPage + 1)
      } else {
        this.viewer.goToPage(this.viewer.currentPage - 1)
      }
      this.updatePageIndicator()
    })

    this.viewport.addEventListener('pointercancel', () => {
      this.swipeStartTime = 0
    })
  }

  bindViewerEvents() {
    this.container.addEventListener('viewer:resetZoom', () => {
      this.panzoom.reset({ animate: true })
      this.onZoomChange()
    })

    this.container.addEventListener('viewer:pageChange', () => {
      this.updatePageIndicator()
    })
  }

  updateModeButton() {
    const isHorizontal = this.viewer.displayMode === 'horizontal'
    this.toggleModeBtn.textContent = isHorizontal ? 'Scroll' : 'Paged'
    this.toggleModeBtn.setAttribute('aria-pressed', isHorizontal.toString())
  }

  updatePanzoomForMode(mode) {
    if (mode === 'horizontal') {
      this.panzoom.setOptions({
        disablePan: true,
        touchAction: 'none',
      })
      this.panzoom.reset({ animate: false })
      this.onZoomChange()
    } else {
      this.panzoom.setOptions({
        disablePan: false,
        panOnlyWhenZoomed: true,
        touchAction: 'auto',
      })
    }
  }

  onZoomChange() {
    const newZoom = this.panzoom.getScale()
    const newTier = this.getQualityTier(newZoom)
    
    this.currentZoom = newZoom
    this.updateZoomDisplay()
    
    if (newTier !== this.currentQualityTier) {
      this.currentQualityTier = newTier
      this.viewer.reRenderAll(newTier)
    }
  }

  updateZoomDisplay() {
    const percentage = Math.round(this.currentZoom * 100)
    this.zoomLevel.textContent = `${percentage}%`
  }

  updatePageIndicator() {
    const currentPage = this.viewer.getCurrentPage()
    const totalPages = this.viewer.pageCount
    this.pageIndicator.textContent = `${currentPage} / ${totalPages}`
  }

  canAutoScroll() {
    return this.viewer.displayMode === 'vertical'
  }

  startAutoScroll() {
    if (this.isAutoScrolling) return
    if (!this.canAutoScroll()) return

    this.isAutoScrolling = true
    this.autoScrollLastTs = null
    this.autoScrollRafId = requestAnimationFrame((ts) => this.autoScrollTick(ts))
    this.updateAutoScrollButton()
  }

  stopAutoScroll() {
    if (!this.isAutoScrolling) return

    this.isAutoScrolling = false
    if (this.autoScrollRafId !== null) {
      cancelAnimationFrame(this.autoScrollRafId)
      this.autoScrollRafId = null
    }
    this.autoScrollLastTs = null
    this.updateAutoScrollButton()
  }

  toggleAutoScroll() {
    if (this.isAutoScrolling) {
      this.stopAutoScroll()
    } else {
      this.startAutoScroll()
    }
  }

  setAutoScrollSpeed(pps) {
    this.autoScrollSpeedPps = Math.max(10, Math.min(50, pps))
    this.updateAutoScrollSpeedDisplay()
  }

  autoScrollTick(timestamp) {
    if (!this.isAutoScrolling) return
    if (!this.canAutoScroll()) {
      this.stopAutoScroll()
      return
    }

    if (this.autoScrollLastTs === null) {
      this.autoScrollLastTs = timestamp
    }

    const dt = (timestamp - this.autoScrollLastTs) / 1000
    this.autoScrollLastTs = timestamp

    const deltaPx = this.autoScrollSpeedPps * dt
    const newScrollTop = this.viewport.scrollTop + deltaPx
    const maxScrollTop = this.viewport.scrollHeight - this.viewport.clientHeight

    if (newScrollTop >= maxScrollTop - 1) {
      this.viewport.scrollTop = maxScrollTop
      this.stopAutoScroll()
      return
    }

    this.viewport.scrollTop = newScrollTop
    this.autoScrollRafId = requestAnimationFrame((ts) => this.autoScrollTick(ts))
  }

  updateAutoScrollButton() {
    const btn = document.getElementById('toggle-autoscroll')
    if (!btn) return

    btn.textContent = this.isAutoScrolling ? '⏸' : '▶'
    btn.setAttribute('aria-pressed', this.isAutoScrolling.toString())
    btn.disabled = !this.canAutoScroll()
  }

  updateAutoScrollSpeedDisplay() {
    const display = document.getElementById('autoscroll-speed-value')
    if (display) {
      display.textContent = `${Math.round(this.autoScrollSpeedPps)}`
    }
  }

  bindAutoScrollEvents() {
    const toggleBtn = document.getElementById('toggle-autoscroll')
    const speedInput = document.getElementById('autoscroll-speed')

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleAutoScroll())
    }

    if (speedInput) {
speedInput.value = this.autoScrollSpeedPps
      speedInput.addEventListener('input', (e) => {
        this.setAutoScrollSpeed(parseFloat(e.target.value) || 30)
      })
    }

    this.viewport.addEventListener('wheel', () => {
      if (this.isAutoScrolling) this.stopAutoScroll()
    }, { passive: true })

    this.viewport.addEventListener('pointerdown', () => {
      if (this.isAutoScrolling) this.stopAutoScroll()
    })

    this.viewport.addEventListener('keydown', (e) => {
      if (this.isAutoScrolling && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        this.stopAutoScroll()
      }
    })
  }

  destroy() {
    if (this.panzoom) {
      this.panzoom.destroy()
    }
  }
}