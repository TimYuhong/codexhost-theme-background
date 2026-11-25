export type Json = string | number | boolean | null | Json[] | JsonObject
export type JsonObject = { [key: string]: Json }
export type Dispose = () => void
export type Scheme = 'light' | 'dark'

export type StorageApi = {
  get(): Promise<JsonObject>
  set(values: JsonObject): Promise<JsonObject>
  onChange(listener: (values: JsonObject) => void): Dispose
}
export type PageApi = {
  readonly id: string
  readonly apiVersion: 1
  readonly hostTarget: 'desktop' | 'web'
  readonly locale: string
  readonly colorScheme: Scheme
  readonly signal: AbortSignal
  onLocaleChange(fn: (locale: string) => void): Dispose
  onColorSchemeChange(fn: (scheme: Scheme) => void): Dispose
  assets: { url(path: string): Promise<string> }
  storage: StorageApi
}
type Marks = {
  mark(target: Element, name: string): void
  unmark(target: Element, name: string): void
}
export type DesktopApi = {
  readonly id: string
  readonly apiVersion: 1
  readonly signal: AbortSignal
  dom: Marks & {
    mount(node: Element, parent: Element, position?: 'append' | 'prepend' | 'before' | 'after'): void
  }
  storage: {
    get(): Promise<Record<string, unknown>>
    set(values: Record<string, unknown>): Promise<Record<string, unknown>>
    onChange(fn: (values: Record<string, unknown>) => void): Dispose
  }
  assets: { readDataUrl(path: string): Promise<{ mimeType: string; dataUrl: string }> }
  track(dispose: Dispose): void
}
export type WebApi = {
  readonly id: string
  readonly apiVersion: 1
  readonly signal: AbortSignal
  dom: Marks & {
    mount(target: HTMLElement | 'app' | 'topbar' | 'sidebar' | 'conversation',
          position?: 'prepend' | 'append'): { container: HTMLElement; dispose: Dispose } | undefined
  }
  storage: StorageApi
  assets: { url(path: string): string }
  track(dispose: Dispose | (() => Promise<void>)): void
}
