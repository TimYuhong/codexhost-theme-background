import { clamp } from '../shared/config.ts'
import { uuid } from '../shared/sync.ts'
import { dictionary } from './i18n.ts'
import type { Key } from './i18n.ts'

export function pageUi(page: HTMLElement, main: HTMLElement, signal: AbortSignal, locale: string, commit: () => void) {
  const doc = page.ownerDocument
  const prefix = `tb-${uuid()}`
  let serial = 0, words = dictionary(locale), dismiss: (() => void) | undefined
  function make<K extends keyof HTMLElementTagNameMap>(tag: K, parent?: HTMLElement, className?: string) {
    const node = doc.createElement(tag)
    if (className) node.className = className
    parent?.append(node)
    return node
  }
  const on = <K extends keyof HTMLElementEventMap>(node: HTMLElement, name: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) =>
    node.addEventListener(name, handler, { ...options, signal })
  function text<T extends HTMLElement>(node: T, key: Key) {
    node.dataset.tbText = key
    node.textContent = words[key]
    return node
  }
  function label(node: HTMLElement, key: Key) {
    node.dataset.tbLabel = key
    node.setAttribute('aria-label', words[key])
  }
  function localize(locale: string) {
    words = dictionary(locale)
    for (const node of page.querySelectorAll<HTMLElement>('[data-tb-text]')) text(node, node.dataset.tbText as Key)
    for (const node of page.querySelectorAll<HTMLElement>('[data-tb-label]')) label(node, node.dataset.tbLabel as Key)
  }
  function button(parent: HTMLElement, key: Key, click: () => void, style?: string) {
    const node = text(make('button', parent, style), key)
    node.type = 'button'
    node.addEventListener('click', () => { if (!signal.aborted) click() })
    return node
  }
  function field(parent: HTMLElement, key: Key) {
    const label = make('label', parent, 'tb-field')
    text(make('span', label), key)
    return label
  }
  function input(parent: HTMLElement, key: Key, type: string) {
    const node = make('input', field(parent, key))
    node.type = type
    return node
  }
  function select<T extends string>(parent: HTMLElement, key: Key, options: readonly T[], captions?: Partial<Record<T, Key>>) {
    const node = make('select', field(parent, key))
    for (const option of options) text(make('option', node), captions?.[option] ?? option as Key).value = option
    return node
  }
  function check(parent: HTMLElement, key: Key, change: (checked: boolean) => void) {
    const node = input(parent, key, 'checkbox')
    node.parentElement?.classList.add('tb-switch')
    on(node, 'change', () => { change(node.checked); commit() })
    return node
  }
  function card(parent: HTMLElement, title?: Key, style = '') {
    const node = make('section', parent, `tb-card ${style}`.trim())
    if (title) text(make('h3', node), title)
    return node
  }
  const value = (node: HTMLInputElement, next: string) => { if (node.value !== next) node.value = next }
  function slider(parent: HTMLElement, key: Key, lo: number, hi: number, step: number, change: (value: number) => void) {
    const row = make('div', parent, 'tb-range')
    const caption = text(make('label', row), key)
    const range = make('input', row), number = make('input', row)
    caption.id = `${prefix}-label-${++serial}`
    range.id = `${prefix}-range-${serial}`
    caption.htmlFor = range.id
    number.setAttribute('aria-labelledby', caption.id)
    range.type = 'range'; number.type = 'number'
    for (const node of [range, number]) { node.min = String(lo); node.max = String(hi); node.step = String(step) }
    let current = lo
    function set(next: number) {
      current = next
      value(range, String(next))
      if (!number.matches(':focus')) value(number, String(next))
    }
    for (const node of [range, number]) {
      const adjust = () => {
        if (!Number.isFinite(node.valueAsNumber)) return
        const next = clamp(Number((lo + Math.round((node.valueAsNumber - lo) / step) * step).toFixed(6)), lo, hi)
        set(next)
        change(next)
      }
      on(node, 'input', adjust)
      on(node, 'change', () => { adjust(); value(node, String(current)); commit() })
    }
    on(number, 'blur', () => value(number, String(current)))
    on(range, 'pointerup', commit)
    return { row, set, range }
  }
  function choices<T extends Key>(parent: HTMLElement, title: Key, keys: readonly T[], change: (key: T) => void, className = 'tb-segments') {
    const group = make('div', parent, className)
    group.setAttribute('role', 'group')
    label(group, title)
    const buttons = keys.map(key => {
      const node = button(group, key, () => change(key))
      node.dataset.tbChoice = key
      return node
    })
    return { group, set(next: T) { buttons.forEach((node, i) => node.setAttribute('aria-pressed', String(keys[i] === next))) } }
  }
  function dialog(title: Key, content: (panel: HTMLElement, finish: (accepted: boolean) => void) => HTMLElement) {
    dismiss?.()
    if (signal.aborted) return Promise.resolve(false)
    const focused = page.getRootNode() as Document | ShadowRoot
    const returnFocus = focused.activeElement as HTMLElement | null
    const panel = make('dialog', page, 'tb-dialog')
    const heading = text(make('h3', panel), title)
    heading.id = `${prefix}-dialog-${++serial}`
    panel.setAttribute('aria-labelledby', heading.id)
    return new Promise<boolean>(resolve => {
      const dialogLife = new AbortController()
      function finish(accepted: boolean) {
        if (dismiss !== abort) return
        dismiss = undefined
        dialogLife.abort()
        main.inert = false
        if (panel.open) panel.close()
        panel.remove()
        if (!signal.aborted && returnFocus?.isConnected) returnFocus.focus()
        resolve(accepted)
      }
      const abort = () => finish(false)
      dismiss = abort
      const focus = content(panel, finish)
      panel.addEventListener('close', abort)
      panel.addEventListener('cancel', event => { event.preventDefault(); abort() })
      doc.defaultView?.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault(); event.stopPropagation(); abort()
        }
      }, { capture: true, signal: dialogLife.signal })
      panel.addEventListener('click', event => {
        if (event.target !== panel) return
        const r = panel.getBoundingClientRect()
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) abort()
      })
      try { panel.showModal() } catch {
        panel.open = true
        panel.classList.add('tb-dialog-fallback')
        panel.setAttribute('aria-modal', 'true')
        main.inert = true
        panel.addEventListener('keydown', event => {
          if (event.key !== 'Tab') return
          const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
          const index = items.indexOf(focused.activeElement as HTMLElement)
          event.preventDefault()
          const offset = event.shiftKey ? -1 : 1
          items[(index < 0 ? (event.shiftKey ? items.length - 1 : 0) : (index + offset + items.length) % items.length)]?.focus()
        })
      }
      focus.focus()
    })
  }
  function confirm(title: Key, message: Key) {
    return dialog(title, (panel, finish) => {
      text(make('p', panel), message)
      const actions = make('div', panel, 'tb-actions')
      const cancel = button(actions, 'cancel', () => finish(false))
      button(actions, 'confirm', () => finish(true), 'tb-primary')
      return cancel
    })
  }
  signal.addEventListener('abort', () => dismiss?.(), { once: true })
  return { doc, prefix, make, on, text, label, localize, button, input, check, select, card, choices, value, slider, dialog, confirm,
    t: (key: Key) => words[key] }
}
export type Ui = ReturnType<typeof pageUi>

export function preserveFocus(root: HTMLElement, render: () => void) {
  const focused = (root.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null
  const key = focused && root.contains(focused) ? focused.dataset.tbFocus : undefined
  render()
  if (key) Array.from(root.querySelectorAll<HTMLElement>('[data-tb-focus]')).find(node => node.dataset.tbFocus === key)?.focus()
}
