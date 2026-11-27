import type { Dispose } from '../host-api.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Crisp 2.5D pixel-voxel CodexHost card-hanger otter & mini laptop screen paths (viewBox 0 0 34 24). */
export const OTTER_BODY_PATH = 'M 11 5 H 23 V 19 H 11 Z'
export const OTTER_ACCENT_PATH = 'M 3 12 H 4 V 13 H 5 V 14 H 6 V 15 H 7 V 16 H 6 V 15 H 5 V 14 H 4 V 13 H 3 Z'

const SPARKS = ['✦', '♥', '✧'] as const

export type OtterPetController = {
  sync(enabled: boolean): void
  isHealthy(): boolean
  hasLostHost(): boolean
  dispose(): void
}

function el<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (children.length) node.append(...children)
  return node
}

function px(doc: Document, x: number, y: number, width: number, height: number, fill: string, cls?: string) {
  const attrs: Record<string, string> = {
    x: String(x),
    y: String(y),
    width: String(width),
    height: String(height),
    fill,
  }
  if (cls) attrs.class = cls
  return el(doc, 'rect', attrs)
}

export function buildOtterSvg(doc: Document): SVGSVGElement {
  // Card top border sits at y = 19; y = 19..23 hangs down ONTO the front face of the card!

  // Mini open coding laptop sitting right on the card rim (y = 12..19)
  const laptop = el(
    doc,
    'g',
    { class: 'tb-otter-laptop' },
    px(doc, 1, 12, 1, 1, '#93a0b0'),
    px(doc, 2, 13, 1, 1, '#93a0b0'),
    px(doc, 3, 14, 1, 1, '#93a0b0'),
    px(doc, 4, 15, 1, 1, '#7f8c9c'),
    px(doc, 5, 16, 1, 1, '#7f8c9c'),
    el(doc, 'path', { class: 'tb-otter-gem', d: OTTER_ACCENT_PATH, fill: '#19a785' }),
    px(doc, 3, 13, 1, 1, '#a0ffe6', 'tb-otter-cursor'),
    px(doc, 5, 15, 1, 1, '#a0ffe6', 'tb-otter-cursor-alt'),
    px(doc, 5, 17, 5, 1, '#a0adbe'),
    px(doc, 6, 17, 2, 1, '#4ae3ba', 'tb-otter-keyglow'),
    px(doc, 5, 18, 5, 1, '#616e80'),
  )

  // Chunky 2.5D voxel otter tail extending from the right back & bobbing softly
  const tail = el(
    doc,
    'g',
    { class: 'tb-otter-tail' },
    px(doc, 26, 14, 3, 1, '#3e84c9'),
    px(doc, 26, 15, 3, 2, '#1a528c'),
    px(doc, 26, 17, 3, 1, '#0d2f54'),
    px(doc, 29, 15, 2, 1, '#2b6eb0'),
    px(doc, 29, 16, 2, 1, '#123c69'),
    px(doc, 31, 14, 2, 1, '#448bd1'),
    px(doc, 31, 15, 2, 1, '#184b80'),
  )

  // Rear tucked hind foot resting neatly behind on the card top edge (y = 17..19)
  const backLegs = el(
    doc,
    'g',
    { class: 'tb-otter-back-legs' },
    px(doc, 23, 17, 2, 2, '#133d6b'),
    px(doc, 25, 17, 1, 2, '#0a2442'),
    px(doc, 24, 18, 2, 1, '#0c2a4d'),
  )

  // Short cute wide-set pixel otter ears (y = 4)
  const leftEar = el(
    doc,
    'g',
    { class: 'tb-otter-ear-l' },
    px(doc, 11, 4, 2, 1, '#3f86cc'),
    px(doc, 13, 4, 1, 1, '#164575'),
  )
  const rightEar = el(
    doc,
    'g',
    { class: 'tb-otter-ear-r' },
    px(doc, 21, 4, 2, 1, '#3f86cc'),
    px(doc, 23, 4, 1, 1, '#164575'),
  )

  // Minimalist crisp square pixel eyes (blinkable)
  const eyes = el(
    doc,
    'g',
    { class: 'tb-otter-eyes' },
    px(doc, 11, 7, 2, 2, '#091524'),
    px(doc, 18, 7, 2, 2, '#091524'),
  )

  // Main 2.5D voxel otter cube resting its tummy on the top edge (y = 5..19)
  const body = el(
    doc,
    'g',
    { class: 'tb-otter-torso' },
    leftEar,
    rightEar,
    el(doc, 'path', { class: 'tb-otter-body', d: OTTER_BODY_PATH, fill: '#2769ab' }),
    // Bright top bevel
    px(doc, 11, 5, 12, 1, '#4f97de'),
    px(doc, 23, 5, 3, 1, '#1f5791'),
    // Shaded 3D right extrusion face
    px(doc, 23, 6, 3, 13, '#144170'),
    px(doc, 23, 18, 3, 1, '#0c2c4f'),
    // Cream otter belly resting snugly along the rim
    px(doc, 12, 13, 9, 5, '#ddebf7'),
    px(doc, 12, 18, 9, 1, '#a9c4dc'),
    // Protruding 2.5D cream otter snout facing left toward the laptop
    px(doc, 8, 9, 3, 1, '#f4f9fe'),
    px(doc, 8, 10, 3, 4, '#e2eef8'),
    px(doc, 8, 13, 3, 1, '#b7cfe3'),
    px(doc, 11, 10, 1, 4, '#c7dced'),
    // Dark pixel otter button nose
    px(doc, 8, 10, 2, 1, '#091524'),
    px(doc, 8, 11, 1, 1, '#091524'),
    eyes,
  )

  // Two clearly visible chunky pixel hands HOOKED OVER the top border (y = 19) onto the card bezel (y = 19..22)!
  const leftHand = el(
    doc,
    'g',
    { class: 'tb-otter-paw-l' },
    // Crisp drop shadow directly beneath fingertips on the card surface
    px(doc, 10, 22, 4, 1, 'rgba(0,0,0,0.4)'),
    // Wrist curving forward from chest over the rim
    px(doc, 10, 17, 3, 1, '#22609e'),
    px(doc, 13, 17, 1, 1, '#113963'),
    // Bright knuckle highlight right on the card top edge (y = 18) showing the grip over the ledge!
    px(doc, 10, 18, 3, 1, '#66aef2'),
    px(doc, 13, 18, 1, 1, '#1a4f85'),
    // Chunky hanging paw draped over the front face of the card (y = 19..21)
    px(doc, 10, 19, 3, 1, '#2b70b5'),
    px(doc, 13, 19, 1, 3, '#113963'),
    // Cute contrasting pale-cream pixel fingers gripping the card front face
    px(doc, 10, 20, 1, 2, '#dcebf7'),
    px(doc, 11, 20, 1, 2, '#0d2b4d'),
    px(doc, 12, 20, 1, 2, '#dcebf7'),
  )

  const rightHand = el(
    doc,
    'g',
    { class: 'tb-otter-paw-r' },
    // Crisp drop shadow directly beneath fingertips on the card surface
    px(doc, 17, 22, 4, 1, 'rgba(0,0,0,0.4)'),
    // Wrist curving forward over the rim
    px(doc, 17, 17, 3, 1, '#22609e'),
    px(doc, 20, 17, 1, 1, '#113963'),
    // Bright knuckle highlight right on the card top edge (y = 18)
    px(doc, 17, 18, 3, 1, '#66aef2'),
    px(doc, 20, 18, 1, 1, '#1a4f85'),
    // Chunky hanging paw draped over the front face of the card (y = 19..21)
    px(doc, 17, 19, 3, 1, '#2b70b5'),
    px(doc, 20, 19, 1, 3, '#113963'),
    // Cute contrasting pale-cream pixel fingers gripping the card front face
    px(doc, 17, 20, 1, 2, '#dcebf7'),
    px(doc, 18, 20, 1, 2, '#0d2b4d'),
    px(doc, 19, 20, 1, 2, '#dcebf7'),
  )

  return el(
    doc,
    'svg',
    {
      viewBox: '0 0 34 23',
      class: 'tb-otter-svg',
      'shape-rendering': 'crispEdges',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    laptop,
    tail,
    backLegs,
    body,
    leftHand,
    rightHand,
  )
}

export function createOtterPet(
  doc: Document,
  selector: string | readonly string[],
  mountTarget: (host: HTMLElement) => { container: HTMLElement; dispose: Dispose } | undefined,
  eventSelector?: string,
): OtterPetController {
  const selectors = typeof selector === 'string' ? [selector] : selector
  const inputSelector = eventSelector ?? selectors.at(-1) ?? ''
  const win = doc.defaultView
  let host: HTMLElement | null = null
  let eventTarget: HTMLElement | null = null
  let mounted: { container: HTMLElement; dispose: Dispose } | undefined
  let petLife: AbortController | undefined
  let moodTimer: number | undefined
  let sparkTimer: number | undefined
  let sparkIndex = 0
  let disposed = false

  function resolveHost(): HTMLElement | null {
    for (const sel of selectors) {
      const found = doc.querySelector<HTMLElement>(sel)
      if (found) return found
    }
    return null
  }

  function clearTimers() {
    if (moodTimer !== undefined) { win?.clearTimeout(moodTimer); moodTimer = undefined }
    if (sparkTimer !== undefined) { win?.clearTimeout(sparkTimer); sparkTimer = undefined }
  }

  function unmount() {
    clearTimers()
    petLife?.abort()
    petLife = undefined
    mounted?.dispose()
    mounted = undefined
    host = null
    eventTarget = null
  }

  function sync(enabled: boolean) {
    if (disposed) return
    if (!enabled) {
      unmount()
      return
    }
    const target = resolveHost()
    if (!target) {
      unmount()
      return
    }
    const listenerTarget = (inputSelector
      ? (target.matches?.(inputSelector)
        ? target
        : target.closest?.<HTMLElement>(inputSelector) ?? doc.querySelector<HTMLElement>(inputSelector))
      : null) ?? target
    if (host === target && eventTarget === listenerTarget && host.isConnected && mounted?.container.isConnected) {
      mounted.container.toggleAttribute('data-tb-pet-hidden', doc.visibilityState === 'hidden')
      return
    }
    unmount()
    const next = mountTarget(target)
    if (!next) return
    host = target
    eventTarget = listenerTarget
    mounted = next
    const life = petLife = new AbortController()
    const { container } = next
    container.classList.add('tb-otter-pet')
    container.setAttribute('aria-hidden', 'true')
    container.dataset.tbPetMood = 'idle'
    container.toggleAttribute('data-tb-pet-hidden', doc.visibilityState === 'hidden')

    const stage = doc.createElement('span')
    stage.className = 'tb-otter-stage'
    const shadow = doc.createElement('span')
    shadow.className = 'tb-otter-shadow'
    const spark = doc.createElement('span')
    spark.className = 'tb-otter-spark'
    spark.hidden = true
    const svg = buildOtterSvg(doc)
    stage.append(svg)
    container.append(shadow, stage, spark)

    const setMood = (mood: 'idle' | 'typing' | 'hop' | 'peek', durationMs = 0) => {
      if (life.signal.aborted) return
      if (moodTimer !== undefined) { win?.clearTimeout(moodTimer); moodTimer = undefined }
      container.dataset.tbPetMood = mood
      if (durationMs > 0 && win) {
        moodTimer = win.setTimeout(() => {
          moodTimer = undefined
          if (!life.signal.aborted) container.dataset.tbPetMood = 'idle'
        }, durationMs)
      }
    }

    const triggerSpark = () => {
      if (life.signal.aborted || !win) return
      if (sparkTimer !== undefined) { win.clearTimeout(sparkTimer); sparkTimer = undefined }
      spark.textContent = SPARKS[sparkIndex++ % SPARKS.length]
      spark.hidden = false
      spark.classList.remove('tb-otter-spark-pop')
      void spark.offsetWidth
      spark.classList.add('tb-otter-spark-pop')
      sparkTimer = win.setTimeout(() => {
        sparkTimer = undefined
        if (!life.signal.aborted) { spark.hidden = true; spark.classList.remove('tb-otter-spark-pop') }
      }, 950)
    }

    const onPetClick = (event: Event) => {
      event.stopPropagation()
      setMood('hop', 720)
      triggerSpark()
    }
    const onTyping = () => {
      if (container.dataset.tbPetMood !== 'hop') setMood('typing', 1100)
    }
    const onFocusIn = () => {
      if (container.dataset.tbPetMood === 'idle') setMood('peek', 640)
    }
    const onVis = () => {
      container.toggleAttribute('data-tb-pet-hidden', doc.visibilityState === 'hidden')
    }

    const opts = { signal: life.signal, passive: true } as const
    container.addEventListener('click', onPetClick, { signal: life.signal })
    container.addEventListener('pointerdown', e => e.stopPropagation(), { signal: life.signal })
    listenerTarget.addEventListener('input', onTyping, opts)
    listenerTarget.addEventListener('keydown', onTyping, opts)
    listenerTarget.addEventListener('focusin', onFocusIn, opts)
    doc.addEventListener('visibilitychange', onVis, opts)
  }

  return {
    sync,
    isHealthy: () => !!host && host.isConnected && !!mounted?.container.isConnected,
    hasLostHost: () => !!host && (!host.isConnected || !mounted?.container.isConnected),
    dispose() {
      if (disposed) return
      disposed = true
      unmount()
    },
  }
}
