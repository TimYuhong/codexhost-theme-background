import { dictionary } from '../src/page/i18n.ts'
import type { Ui } from '../src/page/ui.ts'

class Element extends EventTarget {
  dataset: Record<string, string> = {}
  classList = { toggle() {}, add() {} }
  style: Record<string, unknown> = { setProperty(k: string, v: string) { this[k] = v } }
  children: Element[] = []
  readonly attributes = new Map<string, string>()
  parentElement?: Element
  hidden = false
  disabled = false
  open = false
  value = ''
  valueAsNumber = 0
  textContent = ''
  files?: File[]
  isConnected = true
  className = ''
  naturalWidth = 1
  naturalHeight = 1
  videoWidth = 640
  videoHeight = 360
  width = 0
  height = 0
  src = ''
  constructor() { super() }
  append(node: Element) { this.children.push(node); node.parentElement = this }
  prepend(node: Element) { this.children.unshift(node); node.parentElement = this }
  after(node: Element) { this.parentElement!.append(node) }
  replaceChildren() { this.children = [] }
  find(predicate: (node: Element) => boolean): Element | undefined {
    if (predicate(this)) return this
    for (const child of this.children) { const match = child.find(predicate); if (match) return match }
  }
  querySelectorAll() { return [] }
  getRootNode() { return { activeElement: null } }
  matches() { return false }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  removeAttribute(key: string) { this.attributes.delete(key) }
  toggleAttribute(key: string, force?: boolean) { if (force === false) this.attributes.delete(key); else this.attributes.set(key, '') }
  scrollIntoView() {}
  focus() {}
  pause() {}
  load() {}
  getContext() { return null }
  async decode() {}
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')) }
}

export function fixtures(signal: AbortSignal) {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    defaultView: { matchMedia: () => new EventTarget() },
    createElement: () => new Element(),
  })
  const root = new Element(), choices = new Map<string, (key: string) => void>()
  const make = (_tag: string, parent?: Element, className = '') => {
    const node = Object.assign(new Element(), { className, ownerDocument: doc })
    parent?.append(node)
    return node
  }
  const words = dictionary('en'), t = (key: keyof typeof words) => words[key]
  const text = (node: Element, key: keyof typeof words) => { node.textContent = t(key); return node }
  const button = (parent: Element, key: keyof typeof words, run: () => void, style?: string) => {
    const node = text(make('button', parent, style), key)
    node.addEventListener('click', () => { if (!signal.aborted) run() })
    return node
  }
  const ui = { doc, make, button, text, t, label() {}, prefix: 'tb-fixture', value(node: Element, value: string) { node.value = value },
    on(node: Element, event: string, run: EventListener) { node.addEventListener(event, run, { signal }) },
    check: (parent: Element) => make('input', parent), input: (parent: Element) => make('input', parent), select: (parent: Element) => make('select', parent),
    slider: (parent: Element) => ({ row: make('div', parent), set() {} }),
    card: (parent: Element, _title: string, style: string) => make('section', parent, style),
    choices(parent: Element, label: string, _keys: string[], select: (key: string) => void) {
      choices.set(label, select)
      return { group: make('div', parent), set() {} }
    },
    dialog(_title: keyof typeof words, content: (panel: Element, finish: (accepted: boolean) => void) => Element) {
      const panel = make('dialog', root, 'tb-dialog')
      return new Promise<boolean>(resolve => {
        content(panel, accepted => {
          root.children = root.children.filter(c => c !== panel)
          resolve(accepted)
        })
      })
    },
  } as unknown as Ui
  return { ui, root, make, choices, panel: (className: string) => make('section', root, className) as unknown as HTMLElement }
}
