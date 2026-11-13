// Showing an artboard, and looking at one. Browser only.
//
// An artboard is shown in an <iframe sandbox srcdoc>: no `allow-scripts`, so
// nothing in it runs (and format.ts already took scripts out), and a CSP of
// its own on top of the add-on's: styles and data: images only, no requests.
// Model-written HTML can draw, and that's all it can do.
import type { Artboard, Board } from './board.ts'
import { TAILWIND_FILE, serialize, type ParseHtml } from './format.ts'

export const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:"

/** The artboard's document with the board's stylesheets inlined and the CSP on, for srcdoc. */
export function frameDoc(a: Artboard, board: Board, parse: ParseHtml): string {
  const doc = parse(a.html)
  const sheets: Record<string, string> = { [board.tokensPath]: board.tokensCss() }
  if (board.style === 'tailwind') sheets[TAILWIND_FILE] = board.compiled
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"]')]) {
    const css = sheets[link.getAttribute('href') ?? '']
    if (css === undefined) { link.remove(); continue }
    const style = doc.createElement('style')
    style.textContent = css
    link.replaceWith(style)
  }
  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', FRAME_CSP)
  doc.head.prepend(csp)
  return serialize(doc)
}

export type Block = { element: string; x: number; y: number; width: number; height: number; text?: string }

export type Layout = {
  artboard: { width: number; height: number }
  /** How tall and wide the page's content really is. */
  content: { width: number; height: number }
  problems: string[]
  /** The page's main pieces, top to bottom, in artboard pixels. */
  blocks: Block[]
}

export type Look = { layout: Layout; png?: string; pngSize?: { width: number; height: number }; imageError?: string }

const label = (el: Element) => {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const c = [...el.classList].slice(0, 2)
  return c.length ? `${tag}.${c.join('.')}` : tag
}

function measure(doc: Document, width: number, height: number): Layout {
  const root = doc.documentElement
  const content = { width: Math.max(root.scrollWidth, doc.body.scrollWidth), height: Math.max(root.scrollHeight, doc.body.scrollHeight) }
  const problems: string[] = []
  if (content.height > height + 1) problems.push(`The content is ${content.height - height}px taller than the artboard (${content.height} vs ${height}): it's cut off at the bottom. Make the artboard taller (move_artboard) or the content shorter.`)
  if (content.width > width + 1) problems.push(`Something is ${content.width - width}px wider than the artboard: it sticks out on the right.`)
  const blocks: Block[] = []
  const walk = (el: Element, depth: number) => {
    for (const child of [...el.children]) {
      if (blocks.length >= 30) return
      const r = child.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const big = r.width * r.height >= width * height * 0.01
      const text = (child as HTMLElement).innerText?.replace(/\s+/g, ' ').trim()
      if (big || (depth <= 2 && text)) {
        blocks.push({ element: label(child), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), ...(text ? { text: text.length > 80 ? `${text.slice(0, 80)}…` : text } : {}) })
      }
      if (depth < 3 && big) walk(child, depth + 1)
    }
  }
  walk(doc.body, 0)
  if (!blocks.length) problems.push('The artboard shows nothing yet.')
  for (const img of [...doc.images]) {
    if (img.complete && img.naturalWidth === 0) problems.push(`${label(img)} (${(img.getAttribute('src') ?? '').slice(0, 40) || 'no src'}) doesn't show: only data: images and inline <svg> load in Create.`)
  }
  return { artboard: { width, height }, content, problems: problems.slice(0, 12), blocks }
}

/** Draw a laid-out document to a PNG through SVG <foreignObject>. */
async function draw(doc: Document, width: number, height: number, most: number): Promise<{ png: string; width: number; height: number }> {
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`
  const img = new Image()
  img.decoding = 'sync'
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const scale = Math.min(1, most / width, (most * 2) / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/png')
  return { png: url.slice(url.indexOf(',') + 1), width: canvas.width, height: canvas.height }
}

/**
 * Lay the artboard out off screen (a sandboxed frame this page can read but
 * where nothing runs), measure it, and draw it. The picture can fail where
 * the webview won't read back a drawn <foreignObject>; the layout still comes.
 */
export async function look(srcdoc: string, width: number, height: number, most = 1024): Promise<Look> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-${width + 10000}px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden;pointer-events:none`
  const loaded = new Promise<void>(r => frame.addEventListener('load', () => r(), { once: true }))
  frame.srcdoc = srcdoc
  document.body.append(frame)
  try {
    await Promise.race([loaded, new Promise(r => setTimeout(r, 4000))])
    const doc = frame.contentDocument
    if (!doc) throw new Error("couldn't lay the artboard out")
    await doc.fonts?.ready
    const layout = measure(doc, width, height)
    try {
      const pic = await draw(doc, width, height, most)
      return { layout, png: pic.png, pngSize: { width: pic.width, height: pic.height } }
    } catch (e) {
      return { layout, imageError: String((e as Error).message ?? e) }
    }
  } finally {
    frame.remove()
  }
}
