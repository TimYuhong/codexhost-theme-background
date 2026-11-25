export function prepareVideo(doc: Document) {
  const video = doc.createElement('video')
  video.muted = video.defaultMuted = true
  video.playsInline = true
  video.preload = 'auto'
  return video
}

export function releaseVideo(video: HTMLVideoElement) {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

export function loadVideoFrame(video: HTMLVideoElement, url: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      video.removeEventListener('loadeddata', loaded)
      video.removeEventListener('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(signal.reason ?? new DOMException('Cancelled', 'AbortError'))
    const failed = () => finish(new DOMException('Video frame unavailable', 'EncodingError'))
    const loaded = () => video.videoWidth && video.videoHeight ? finish() : failed()
    const timer = setTimeout(failed, 8000)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    video.addEventListener('loadeddata', loaded)
    video.addEventListener('error', failed)
    video.src = url
  })
}
