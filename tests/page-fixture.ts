import { dictionary } from '../src/page/i18n.ts'
import type { Ui } from '../src/page/ui.ts'

class Element extends EventTarget {
  dataset: Record<string, string> = {}
  classList = { toggle() {} }
  style: Record<string, string> = {}
  children: Element[] = []
  readonly attributes = new Map<string, string>()
  parentElement?: Element
  hidden = false
  disabled = false
  open = false
  value = ''
  textContent = ''
  files?: File[]
  isConnected = true
  className = ''
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
  scrollIntoView() {}
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')) }
}

export function fixtures(signal: AbortSignal) {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', defaultView: { matchMedia: () => new EventTarget() } })
  const root = new Element(), choices = new Map<string, (key: string) => void>()
  const make = (_tag: string, parent?: Element, className = '') => {
    const node = Object.assign(new Element(), { className, ownerDocument: doc })
    parent?.append(node)
    return node
  }
  const words = dictionary('en'), t = (key: keyof typeof words) => words[key]
  const text = (node: Element, key: keyof typeof words) => { node.textContent = t(key); return node }
  const button = (parent: Element, key: keyof typeof words, run: () => void) => {
    const node = text(make('button', parent), key)
    node.addEventListener('click', run, { signal })
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
  } as unknown as Ui
  return { ui, root, make, choices, panel: (className: string) => make('section', root, className) as unknown as HTMLElement }
}
