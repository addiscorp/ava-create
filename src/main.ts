// Create: an infinite canvas of HTML/CSS artboards that Ava builds with tools
// while the person watches. The board lives in the add-on's own storage as
// the files of the board format (format.ts, FORMAT.md): `board/board.json`,
// `board/tokens.css`, `board/<id>.html`.
import '@fontsource/comfortaa/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import './style.css'
// The MCP Apps view SDK (the official @modelcontextprotocol/ext-apps, its
// self-contained build): Create is an MCP App view whose tools Ava calls.
import { App } from '@modelcontextprotocol/ext-apps/app-with-deps'
import manifest from '../public/manifest.json'
import { applyContext } from './host.ts'
import { Board, idOf, type Artboard, type Change } from './board.ts'
import { STYLES, type Cleaned, type ParseHtml, type StyleKind } from './format.ts'
import { patchFrom } from './patch.ts'
import { frameDoc, look } from './render.ts'

// ---- Ava's client (served at /ava.js) ----
type Transport = { start(): Promise<void>; send(message: unknown): Promise<void>; close(): Promise<void> }
type Ava = {
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>; keys(): Promise<string[]> }
  on(method: string, fn: (params: Record<string, unknown>) => void): () => void
  transport(): Transport
}
const ava = (window as unknown as { ava: Ava }).ava

const parse: ParseHtml = html => new DOMParser().parseFromString(html, 'text/html')

// ---- The board's files, in the add-on's storage ----
// A folder of files under `board/`: the same shape an export to a folder the
// person picks will write (step 3), through the same `Files` interface.
export type Files = { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void>; remove(path: string): Promise<void> }
const PREFIX = 'board/'
const storageFiles: Files = {
  async read(path) {
    const v = await ava.storage.get(PREFIX + path)
    return typeof v === 'string' ? v : null
  },
  write: (path, text) => ava.storage.set(PREFIX + path, text),
  remove: path => ava.storage.delete(PREFIX + path),
}

let board: Board = Board.empty(parse)
let saveError: string | null = null
const dirty = new Map<string, 'write' | 'remove'>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<void> = Promise.resolve()

function queueSave(c: Change) {
  for (const p of c.wrote) dirty.set(p, 'write')
  for (const p of c.removed) dirty.set(p, 'remove')
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; saving = saving.then(flush) }, 200)
}

/** The saved board couldn't be read: never write over it. */
let keepSaved = false

async function flush() {
  if (!dirty.size || keepSaved) return
  const files = board.files()
  const work = [...dirty]
  dirty.clear()
  try {
    for (const [path, what] of work) {
      const text = files.get(path)
      if (what === 'write' && text !== undefined) await storageFiles.write(path, text)
      else await storageFiles.remove(path)
    }
    saveError = null
  } catch (e) {
    for (const [p, w] of work) if (!dirty.has(p)) dirty.set(p, w)
    saveError = String((e as Error).message ?? e)
  }
  renderStatus()
}

/** Wait until everything changed so far is in storage. */
async function saved() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saving = saving.then(flush) }
  await saving
}

// ---- Tailwind boards: tailwind.css follows the artboards and tokens ----
let compiling: Promise<void> = Promise.resolve()
let compileTimer: ReturnType<typeof setTimeout> | null = null
let compileQueued = false
function queueCompile() {
  if (board.style !== 'tailwind') return
  compileQueued = true
  if (compileTimer) clearTimeout(compileTimer)
  compileTimer = setTimeout(() => { compileTimer = null; compiling = compiling.then(compileNow) }, 60)
}
async function compileNow() {
  if (!compileQueued || board.style !== 'tailwind') return
  compileQueued = false
  try {
    const [{ candidates, compileTailwind }, tw] = await Promise.all([import('./tailwind.ts'), import('tailwindcss/index.css?raw')])
    const css = await compileTailwind(board.tokens(), candidates(board.list().map(a => parse(a.html))), tw.default)
    board.setCompiled(css)
  } catch (e) {
    console.error('Create: compiling Tailwind failed', e)
  }
}
/** Wait until a Tailwind board's CSS matches its artboards. */
async function compiled() {
  if (compileTimer) { clearTimeout(compileTimer); compileTimer = null; compiling = compiling.then(compileNow) }
  await compiling
}

// ---- DOM helpers ----
type Child = Node | string | null | undefined | false
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else el.setAttribute(k, String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}
const svg = (path: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16')
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8')
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round')
  s.innerHTML = path
  return s
}
const ICONS = {
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  tokens: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="8" cy="16" r="3"/><circle cx="16" cy="16" r="3"/>',
}

// ---- The canvas ----
// The camera: a screen point is world * z + (x, y).
const cam = { x: 80, y: 80, z: 0.25 }
const MIN_Z = 0.02
const MAX_Z = 4
let selected: string | null = null
let tokensOpen = false

const app = document.getElementById('app') as HTMLElement
const viewport = h('div', { class: 'viewport', tabindex: '0', 'aria-label': 'Design canvas' })
const world = h('div', { class: 'world' })
const empty = h('div', { class: 'empty' },
  h('img', { class: 'mark', src: '/icon.svg', alt: '' }),
  h('h1', {}, 'Ask Ava to design something'),
  h('p', {}, 'Try “Design a landing page for a neighbourhood bakery in Create: a home page, a menu and a contact page.” Each page appears here as an artboard while she works.'),
)
const zoomLabel = h('button', { class: 'zoom', title: 'Zoom to 100%', onclick: () => zoomTo(1) }, '25%')
const status = h('span', { class: 'status' })
const styleSwitch = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Board style' })
const tokensPanel = h('div', { class: 'tokens-panel' })
const toolbar = h('div', { class: 'toolbar' },
  status,
  styleSwitch,
  h('button', { class: 'icon', title: 'Design tokens', 'aria-label': 'Design tokens', onclick: () => { tokensOpen = !tokensOpen; renderTokens() } }, svg(ICONS.tokens)),
  h('span', { class: 'sep' }),
  h('button', { class: 'icon', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, svg(ICONS.minus)),
  zoomLabel,
  h('button', { class: 'icon', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, svg(ICONS.plus)),
  h('button', { class: 'icon', title: 'Fit everything (Shift+1)', 'aria-label': 'Fit everything', onclick: () => fit() }, svg(ICONS.fit)),
)
viewport.append(world)
app.append(viewport, empty, toolbar, tokensPanel)

/** One artboard's elements, kept between renders so frames don't reload needlessly. */
type View = { root: HTMLElement; label: HTMLElement; frame: HTMLIFrameElement; doc: string }
const views = new Map<string, View>()

function applyCamera() {
  world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`
  viewport.style.setProperty('--z', String(cam.z))
  // The dot grid moves with the board; it thins out (4× apart) as you zoom out.
  let g = 24
  while (g * cam.z < 14) g *= 4
  viewport.style.backgroundSize = `${g * cam.z}px ${g * cam.z}px`
  viewport.style.backgroundPosition = `${cam.x}px ${cam.y}px`
  zoomLabel.textContent = `${Math.round(cam.z * 100)}%`
  saveView()
}

let viewTimer: ReturnType<typeof setTimeout> | null = null
function saveView() {
  if (viewTimer) clearTimeout(viewTimer)
  viewTimer = setTimeout(() => { void ava.storage.set('view', { ...cam }).catch(() => {}) }, 400)
}

function renderArtboard(a: Artboard) {
  const id = idOf(a)
  let v = views.get(id)
  if (!v) {
    const frame = h('iframe', { sandbox: '', referrerpolicy: 'no-referrer', loading: 'eager', title: a.name, tabindex: '-1' })
    const label = h('div', { class: 'label' })
    const root = h('div', { class: 'artboard', 'data-id': id }, label, h('div', { class: 'sheet' }, frame))
    label.addEventListener('pointerdown', e => startMove(e, id))
    root.addEventListener('pointerdown', e => { if (e.button === 0) select(id) })
    world.append(root)
    v = { root, label, frame, doc: '' }
    views.set(id, v)
  }
  v.root.style.left = `${a.x}px`
  v.root.style.top = `${a.y}px`
  v.root.style.width = `${a.width}px`
  v.root.style.height = `${a.height}px`
  v.root.classList.toggle('selected', selected === id)
  v.label.textContent = ''
  v.label.append(h('span', { class: 'name' }, a.name), h('span', { class: 'size' }, `${a.width} × ${a.height}`))
  v.frame.title = a.name
  const doc = frameDoc(a, board, parse)
  if (doc !== v.doc) {
    v.doc = doc
    v.frame.srcdoc = doc
  }
}

function renderBoard() {
  const ids = new Set(board.list().map(idOf))
  for (const [id, v] of views) if (!ids.has(id)) { v.root.remove(); views.delete(id) }
  for (const a of board.list()) renderArtboard(a)
  empty.hidden = ids.size > 0
  renderStatus()
  renderStyle()
  renderTokens()
}

function renderStatus() {
  const n = board.list().length
  status.textContent = saveError ? 'Not saved' : `${n} artboard${n === 1 ? '' : 's'}`
  status.classList.toggle('bad', !!saveError)
  status.title = saveError ?? ''
}

function renderStyle() {
  styleSwitch.textContent = ''
  for (const s of STYLES) {
    styleSwitch.append(h('button', {
      role: 'radio', 'aria-checked': String(board.style === s), class: board.style === s ? 'on' : '',
      title: s === 'css' ? 'Artboards styled with their own CSS' : 'Artboards styled with Tailwind classes',
      onclick: () => setStyle(s),
    }, s === 'css' ? 'CSS' : 'Tailwind'))
  }
}

function renderTokens() {
  tokensPanel.hidden = !tokensOpen
  if (!tokensOpen) return
  tokensPanel.textContent = ''
  const entries = Object.entries(board.tokens())
  tokensPanel.append(h('h2', {}, 'Design tokens'), h('p', { class: 'small' }, 'Every artboard can use these as var(--name). Ask Ava to change them.'))
  const list = h('div', { class: 'token-list' })
  for (const [k, v] of entries) {
    const sw = h('span', { class: 'swatch' })
    sw.style.background = v
    list.append(h('div', { class: 'token' }, sw, h('code', {}, k), h('span', { class: 'val', title: v }, v)))
  }
  if (!entries.length) list.append(h('p', { class: 'small' }, 'No tokens yet.'))
  tokensPanel.append(list)
}

function setStyle(s: StyleKind) {
  board.setStyle(s)
}

/** Pulse an artboard Ava just changed, and bring it into view if it's off screen. */
function flash(id: string) {
  const v = views.get(id)
  if (!v) return
  v.root.classList.remove('flash')
  void v.root.offsetWidth
  v.root.classList.add('flash')
  const a = board.find(id)
  if (!a) return
  const r = viewport.getBoundingClientRect()
  const sx = a.x * cam.z + cam.x
  const sy = a.y * cam.z + cam.y
  const visible = sx < r.width && sy < r.height && sx + a.width * cam.z > 0 && sy + a.height * cam.z > 0
  if (!visible) focusOn([a])
}

function select(id: string | null) {
  if (selected === id) return
  selected = id
  for (const [k, v] of views) v.root.classList.toggle('selected', k === id)
}

// ---- Camera ----
function zoomAt(z: number, sx: number, sy: number) {
  const nz = Math.min(MAX_Z, Math.max(MIN_Z, z))
  const wx = (sx - cam.x) / cam.z
  const wy = (sy - cam.y) / cam.z
  cam.z = nz
  cam.x = sx - wx * nz
  cam.y = sy - wy * nz
  applyCamera()
}
const center = () => { const r = viewport.getBoundingClientRect(); return [r.width / 2, r.height / 2] as const }
const zoomBy = (f: number) => zoomAt(cam.z * f, ...center())
const zoomTo = (z: number) => zoomAt(z, ...center())

function focusOn(list: Artboard[], most = 1) {
  if (!list.length) return
  const r = viewport.getBoundingClientRect()
  const x0 = Math.min(...list.map(a => a.x))
  const y0 = Math.min(...list.map(a => a.y))
  const x1 = Math.max(...list.map(a => a.x + a.width))
  const y1 = Math.max(...list.map(a => a.y + a.height))
  const pad = 56
  const top = 64
  const z = Math.min(most, MAX_Z, Math.max(MIN_Z, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - top - pad) / (y1 - y0))))
  cam.z = z
  cam.x = (r.width - (x1 - x0) * z) / 2 - x0 * z
  cam.y = top + (r.height - top - pad - (y1 - y0) * z) / 2 - y0 * z
  applyCamera()
}
const fit = () => focusOn(board.list())

// Pan: drag the background (or anything with the middle button, or with Space held).
let space = false
let drag: { kind: 'pan' | 'move'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null
viewport.addEventListener('pointerdown', e => {
  const onBoard = (e.target as HTMLElement).closest('.artboard')
  if (e.button === 1 || space || (e.button === 0 && !onBoard)) {
    if (!onBoard) select(null)
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: cam.x, oy: cam.y, moved: false }
    viewport.setPointerCapture(e.pointerId)
    viewport.classList.add('panning')
    e.preventDefault()
  }
})
function startMove(e: PointerEvent, id: string) {
  if (e.button !== 0 || space) return
  const a = board.find(id)
  if (!a) return
  select(id)
  drag = { kind: 'move', id, sx: e.clientX, sy: e.clientY, ox: a.x, oy: a.y, moved: false }
  viewport.setPointerCapture(e.pointerId)
  e.stopPropagation()
  e.preventDefault()
}
viewport.addEventListener('pointermove', e => {
  if (!drag) return
  const dx = e.clientX - drag.sx
  const dy = e.clientY - drag.sy
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
  if (drag.kind === 'pan') {
    cam.x = drag.ox + dx
    cam.y = drag.oy + dy
    applyCamera()
  } else if (drag.id) {
    const v = views.get(drag.id)
    if (v) {
      v.root.style.left = `${Math.round(drag.ox + dx / cam.z)}px`
      v.root.style.top = `${Math.round(drag.oy + dy / cam.z)}px`
    }
  }
})
const endDrag = (e: PointerEvent) => {
  if (!drag) return
  if (drag.kind === 'move' && drag.id && drag.moved) {
    board.place(drag.id, { x: drag.ox + (e.clientX - drag.sx) / cam.z, y: drag.oy + (e.clientY - drag.sy) / cam.z })
  }
  drag = null
  viewport.classList.remove('panning')
}
viewport.addEventListener('pointerup', endDrag)
viewport.addEventListener('pointercancel', endDrag)

// Wheel: scroll pans; pinch (ctrl+wheel) or ⌘/Ctrl+scroll zooms at the pointer.
viewport.addEventListener('wheel', e => {
  e.preventDefault()
  const r = viewport.getBoundingClientRect()
  if (e.ctrlKey || e.metaKey) {
    zoomAt(cam.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top)
  } else {
    cam.x -= e.deltaX
    cam.y -= e.deltaY
    applyCamera()
  }
}, { passive: false })
// Safari's own pinch events (WebKit sends these, not ctrl+wheel, on some trackpads).
let gestureStart = 1
viewport.addEventListener('gesturestart', e => { e.preventDefault(); gestureStart = cam.z })
viewport.addEventListener('gesturechange', e => {
  e.preventDefault()
  const g = e as unknown as { scale: number; clientX: number; clientY: number }
  const r = viewport.getBoundingClientRect()
  zoomAt(gestureStart * g.scale, g.clientX - r.left, g.clientY - r.top)
})

addEventListener('keydown', e => {
  if ((e.target as Element | null)?.closest?.('input, textarea')) return
  if (e.code === 'Space') { space = true; viewport.classList.add('grab') }
  const mod = e.metaKey || e.ctrlKey
  if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fit() }
  else if (e.shiftKey && e.code === 'Digit2' && selected) { e.preventDefault(); const a = board.find(selected); if (a) focusOn([a], MAX_Z) }
  else if ((mod && e.key === '0') || (!mod && e.key === '0' && !e.shiftKey)) { e.preventDefault(); zoomTo(1) }
  else if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(1.25) }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.25) }
  else if (e.key === 'Escape') select(null)
})
addEventListener('keyup', e => { if (e.code === 'Space') { space = false; viewport.classList.remove('grab') } })
addEventListener('resize', () => applyCamera())

// ---- Ava's tools ----
let markLoaded: () => void = () => {}
const loaded = new Promise<void>(r => { markLoaded = r })
type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const int = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : undefined
}
const summary = (a: Artboard) => ({ id: idOf(a), name: a.name, x: a.x, y: a.y, width: a.width, height: a.height })
/** What cleaning took out, said plainly; nothing when nothing was. */
function notes(c: Cleaned): string[] {
  const out: string[] = []
  if (c.removed.length) out.push(`Removed ${[...new Set(c.removed)].join(', ')}: artboards are HTML and CSS only, nothing in them runs.`)
  if (c.remote) out.push(`${c.remote} image(s) or stylesheet(s) point at the internet and won't load in Create: use inline <svg> or data: URLs.`)
  return out
}
const ref = (args: Args) => {
  const r = str(args.artboard) || str(args.id) || str(args.name)
  if (!r) throw new Error('Say which artboard in `artboard` (its id from list_artboards, or its name).')
  return r
}

const handlers: Record<string, (args: Args) => Promise<unknown>> = {
  async list_artboards() {
    await loaded
    return { board: board.name, style: board.style, artboards: board.list().map(summary), tokens: Object.keys(board.tokens()) }
  },
  async new_artboard(args) {
    await loaded
    const name = str(args.name)
    if (!name) throw new Error('Give the artboard a `name`, e.g. "Home".')
    const html = typeof args.html === 'string' ? args.html : undefined
    const { artboard, cleaned } = board.create({ name, html, width: int(args.width), height: int(args.height), x: int(args.x), y: int(args.y) })
    if (board.list().length === 1) focusOn([artboard], 1)
    return { created: summary(artboard), notes: notes(cleaned), next: html?.trim() ? undefined : 'It is blank: fill it with write_artboard.', open: { path: idOf(artboard) } }
  },
  async read_artboard(args) {
    await loaded
    const a = board.get(ref(args))
    return { ...summary(a), html: a.html, open: { path: idOf(a) } }
  },
  async write_artboard(args) {
    await loaded
    if (typeof args.html !== 'string' || !args.html.trim()) throw new Error('Give the whole page in `html`.')
    const { artboard, cleaned } = board.write(ref(args), args.html)
    return { wrote: summary(artboard), notes: notes(cleaned), undo: 'If this made it worse, undo_artboard puts it back.', open: { path: idOf(artboard) } }
  },
  async patch_artboard(args) {
    await loaded
    const { artboard, report, cleaned } = board.patch(ref(args), patchFrom(args))
    const say = [...notes(cleaned)]
    if (report.unchanged) say.unshift('Nothing looks different: what you set is what was already there.')
    if (report.matched > report.changes.length) say.push(`Only the first ${report.changes.length} of the ${report.matched} changes are listed.`)
    return {
      patched: summary(artboard),
      matched: report.matched,
      changes: report.changes,
      notes: say,
      undo: 'If this made it worse, undo_artboard puts it back.',
      open: { path: idOf(artboard) },
    }
  },
  async undo_artboard(args) {
    await loaded
    const { artboard, left } = board.undo(ref(args))
    return { undone: summary(artboard), more_undos: left, open: { path: idOf(artboard) } }
  },
  async move_artboard(args) {
    await loaded
    const name = typeof args.name === 'string' ? args.name : undefined
    const a = board.place(ref(args), { name, x: int(args.x), y: int(args.y), width: int(args.width), height: int(args.height) })
    return { moved: summary(a), open: { path: idOf(a) } }
  },
  async delete_artboard(args) {
    await loaded
    const a = board.remove(ref(args))
    if (selected === idOf(a)) selected = null
    return { deleted: idOf(a), name: a.name }
  },
  async get_tokens() {
    await loaded
    return { tokens: board.tokens(), use: 'var(--name) in any artboard\'s CSS' }
  },
  async set_tokens(args) {
    await loaded
    let t = args.tokens
    if (typeof t === 'string') { try { t = JSON.parse(t) } catch { /* not JSON: refused below */ } }
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Give `tokens` as an object, e.g. { "--color-accent": "#e4572e" }.')
    const r = board.setTokens(t as Record<string, unknown>)
    return { ...r, tokens: board.tokens() }
  },
  async look_at_artboard(args) {
    await loaded
    const a = board.get(ref(args))
    await compiled()
    const seen = await look(frameDoc(a, board, parse), a.width, a.height)
    return { __look: seen, artboard: summary(a) }
  },
  async set_board_style(args) {
    await loaded
    const s = str(args.style).toLowerCase() as StyleKind
    if (!STYLES.includes(s)) throw new Error('`style` is "css" or "tailwind".')
    const was = board.style
    board.setStyle(s)
    return {
      style: s,
      was,
      say: s === 'tailwind'
        ? 'Style artboards with Tailwind classes now; tokens are the theme (--color-accent → bg-accent, text-accent). Existing <style> blocks still work.'
        : 'Style artboards with their own <style> CSS now. Tailwind classes in existing artboards no longer do anything: rewrite those artboards in CSS.',
    }
  },
}

// ---- Board changes: save, compile, redraw ----
let drawQueued = false
let flashIds = new Set<string>()
function onChange(c: Change) {
  queueSave(c)
  if (c.wrote.some(p => p.endsWith('.html') || p === board.tokensPath) || c.removed.length) queueCompile()
  if (c.artboard) flashIds.add(c.artboard)
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(() => {
    drawQueued = false
    renderBoard()
    for (const id of flashIds) flash(id)
    flashIds = new Set()
  })
}

// ---- Create as an MCP App view ----
// Its tools are the manifest's (one list), with the MCP annotations of each
// one's class; Ava treats them as hints and holds the manifest's class.
const ANNOTATIONS = {
  read: { readOnlyHint: true, openWorldHint: false },
  inside: { readOnlyHint: false, openWorldHint: false },
  outside: { readOnlyHint: false, openWorldHint: true },
} as const
const TOOLS = manifest.tools.map(t => ({
  name: t.name,
  description: t.description,
  inputSchema: t.input_schema,
  annotations: ANNOTATIONS[t.effect as keyof typeof ANNOTATIONS],
}))

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** A tool's answer as MCP content. look_at_artboard's carries its picture. */
function answer(value: unknown): { content: Content[]; structuredContent: Record<string, unknown> } {
  const v = value as { __look?: Awaited<ReturnType<typeof look>>; artboard?: unknown }
  if (v && typeof v === 'object' && v.__look) {
    const seen = v.__look
    const data: Record<string, unknown> = {
      artboard: v.artboard,
      layout: seen.layout,
      picture: seen.png ? { attached: true, width: seen.pngSize?.width, height: seen.pngSize?.height } : { attached: false, why: seen.imageError },
    }
    const content: Content[] = []
    if (seen.png) content.push({ type: 'image', data: seen.png, mimeType: 'image/png' })
    content.push({ type: 'text', text: JSON.stringify(data) })
    return { content, structuredContent: data }
  }
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }
}

const view = new App({ name: manifest.name, version: manifest.version }, { tools: { listChanged: false } })
view.onlisttools = async () => ({ tools: TOOLS }) as never
view.oncalltool = async params => {
  const fn = handlers[params.name]
  try {
    if (!fn) throw new Error(`Create has no tool ${params.name}.`)
    const value = await fn((params.arguments ?? {}) as Args)
    // Changed-data tools answer once the change is stored (and, for a
    // Tailwind board, compiled), so a restart right after never loses it.
    await compiled()
    await saved()
    return answer(value) as never
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: String((e as Error).message ?? e) }] }
  }
}
view.onhostcontextchanged = ctx => applyContext(ctx)
void view.connect(ava.transport() as never).then(() => applyContext(view.getHostContext())).catch(e => console.error('Create: connecting to Ava failed', e))

// Ava opens Create at an artboard (a chat chip, or her `open` tool).
ava.on('ava/notifications/open', async m => {
  await loaded
  const a = board.find(str(m.path))
  if (a) { select(idOf(a)); focusOn([a]) }
})

// ---- Start ----
void (async () => {
  try {
    board = await Board.load(parse, p => storageFiles.read(p))
  } catch (e) {
    // A board.json this version can't read stays where it is, untouched; Create starts empty beside it.
    console.error('Create: the saved board could not be read', e)
    saveError = `The saved board couldn't be read, so nothing is saved over it: ${String((e as Error).message ?? e)}`
    keepSaved = true
    board = Board.empty(parse)
  }
  board.onChange(onChange)
  const v = await ava.storage.get('view').catch(() => null) as { x?: number; y?: number; z?: number } | null
  if (v && [v.x, v.y, v.z].every(n => typeof n === 'number' && Number.isFinite(n))) Object.assign(cam, v)
  renderBoard()
  if (!v && board.list().length) fit()
  else applyCamera()
  if (board.style === 'tailwind' && !board.compiled) queueCompile()
  markLoaded()
})()
