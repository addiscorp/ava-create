// The Create board format, version 1 (FORMAT.md is the spec; this is the
// one implementation of it here). A board is plain files:
//
//   board.json      format version, the board's name, and where each artboard sits
//   tokens.css      the shared design tokens: CSS custom properties on :root
//   <id>.html       one standalone HTML document per artboard
//
// Nothing here touches the DOM or Ava: a parser is passed in where HTML has
// to be read, so the same code runs in the add-on and in the tests.

export const FORMAT_VERSION = 1
export const BOARD_FILE = 'board.json'
export const TOKENS_FILE = 'tokens.css'

/** Where one artboard sits on the board, as board.json records it. */
export type ArtboardEntry = {
  /** Its file next to board.json, e.g. `home.html`. */
  file: string
  name: string
  x: number
  y: number
  width: number
  height: number
  /** Fields a later version or another tool wrote: kept as they were. */
  [extra: string]: unknown
}

/**
 * How the artboards are styled: `css` (their own `<style>`, plain CSS) or
 * `tailwind` (Tailwind utility classes, compiled by whoever renders them).
 * Per board, because Tailwind → CSS is exact and CSS → Tailwind is not.
 */
export type StyleKind = 'css' | 'tailwind'
export const STYLES: readonly StyleKind[] = ['css', 'tailwind']

export type BoardJson = {
  version: number
  name: string
  style: StyleKind
  tokens: string
  artboards: ArtboardEntry[]
  [extra: string]: unknown
}

/** Turns HTML text into a Document (DOMParser in a page, linkedom in tests). */
export type ParseHtml = (html: string) => Document

export const MIN_SIDE = 16
export const MAX_SIDE = 10000

const FILE_RE = /^[a-z0-9][a-z0-9-]{0,62}\.html$/

/** A file name an artboard may have: lowercase, digits and `-`, then `.html`. No folders. */
export function validFile(file: string): boolean {
  return FILE_RE.test(file)
}

/** `My Landing Page!` → `my-landing-page`. */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return s || 'artboard'
}

/** A file for an artboard called `name` that isn't in `taken`. */
export function fileFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slug(name)
  for (let n = 1; ; n++) {
    const file = `${n === 1 ? base : `${base}-${n}`}.html`
    if (!used.has(file)) return file
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const side = (v: number) => Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, v)))

function tokensPath(v: unknown): string {
  if (v === undefined || v === null || v === '') return TOKENS_FILE
  if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}\.css$/.test(v) || v === 'tailwind.css') throw new Error('board.json: `tokens` must be a file name like tokens.css')
  return v
}

/** Read board.json. Throws with a plain reason when it isn't a version-1 board. */
export function parseBoardJson(text: string): BoardJson {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('board.json is not JSON')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('board.json must be an object')
  const o = raw as Record<string, unknown>
  if (!Number.isInteger(o.version) || (o.version as number) < 1) throw new Error('board.json needs a whole-number `version`')
  if ((o.version as number) > FORMAT_VERSION) throw new Error(`board.json is format version ${o.version}; this reads version ${FORMAT_VERSION}`)
  if (!Array.isArray(o.artboards)) throw new Error('board.json needs an `artboards` list')
  const files = new Set<string>()
  const artboards = o.artboards.map((a, i): ArtboardEntry => {
    if (!a || typeof a !== 'object') throw new Error(`artboard ${i + 1} must be an object`)
    const e = a as Record<string, unknown>
    if (typeof e.file !== 'string' || !validFile(e.file)) throw new Error(`artboard ${i + 1}: \`file\` must be a name like home.html (lowercase, digits, -)`)
    if (files.has(e.file)) throw new Error(`artboard ${i + 1}: ${e.file} is listed twice`)
    files.add(e.file)
    for (const k of ['x', 'y', 'width', 'height'] as const) if (!finite(e[k])) throw new Error(`artboard ${i + 1}: \`${k}\` must be a number`)
    return {
      ...e,
      file: e.file,
      name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : e.file.replace(/\.html$/, ''),
      x: e.x as number,
      y: e.y as number,
      width: side(e.width as number),
      height: side(e.height as number),
    }
  })
  if (o.style !== undefined && !STYLES.includes(o.style as StyleKind)) throw new Error(`board.json: \`style\` is "css" or "tailwind", not ${JSON.stringify(o.style)}`)
  return {
    ...o,
    version: o.version as number,
    name: typeof o.name === 'string' ? o.name : 'Board',
    style: (o.style as StyleKind | undefined) ?? 'css',
    tokens: tokensPath(o.tokens),
    artboards,
  }
}

/** board.json as Create writes it: two-space JSON, a newline at the end. */
export function writeBoardJson(b: BoardJson): string {
  const { version, name, style, tokens, artboards, ...rest } = b
  return `${JSON.stringify({ version, name, style, tokens, ...rest, artboards: artboards.map(({ file, name, x, y, width, height, ...more }) => ({ file, name, x, y, width, height, ...more })) }, null, 2)}\n`
}

// ---- tokens.css ----

export type Tokens = Record<string, string>

/** `brand` or `--brand` → `--brand`; null when it can't be a custom property name. */
export function tokenName(name: string): string | null {
  const n = name.trim().replace(/^(--)?/, '--')
  return /^--[A-Za-z0-9_-]+$/.test(n) && n.length <= 66 ? n : null
}

/** A value that can sit in a declaration without ending it or the stylesheet. */
export function tokenValue(value: string): string | null {
  const v = value.trim()
  return v && v.length <= 400 && !/[;{}<>]|\/\*/.test(v) ? v : null
}

/** The custom properties declared in the `:root` rules of a stylesheet, in order. */
export function parseTokens(css: string): Tokens {
  const out: Tokens = {}
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of text.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].split(';')) {
      const at = d.indexOf(':')
      if (at < 0) continue
      const name = tokenName(d.slice(0, at))
      const value = d.slice(at + 1).trim()
      if (name && value) out[name] = value
    }
  }
  return out
}

/** tokens.css as Create writes it: one `:root` rule. */
export function writeTokens(tokens: Tokens): string {
  const lines = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`)
  return `:root {\n${lines.join('\n')}\n}\n`
}

/** What a new board starts with, so the first artboard has something to use. */
export const STARTER_TOKENS: Tokens = {
  '--font-sans': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--font-serif': 'ui-serif, Georgia, "Times New Roman", serif',
  '--color-bg': '#ffffff',
  '--color-surface': '#f5f3ef',
  '--color-text': '#1c1a17',
  '--color-muted': '#6b665e',
  '--color-accent': '#6646ee',
  '--color-on-accent': '#ffffff',
  '--radius': '12px',
  '--space': '8px',
}

// ---- Artboard documents ----

/** What cleaning an artboard's HTML took out, to tell whoever wrote it. */
export type Cleaned = { removed: string[]; remote: number }

const DANGEROUS = 'script, iframe, frame, frameset, object, embed, applet, portal, base, noscript'

/**
 * An artboard as the format stores it: a standalone HTML document with its
 * title, `<meta charset>` and a link to tokens.css, holding HTML and CSS only.
 * A fragment (`<section>…</section>`) becomes that document's body. Scripts,
 * frames, plugins, event-handler attributes and `javascript:` URLs are taken
 * out: an artboard is a design, and the file must be as harmless opened on
 * its own as it is inside Create.
 */
export function standalone(html: string, name: string, parse: ParseHtml, links: Links = { tokens: TOKENS_FILE, tailwind: false }): { html: string; cleaned: Cleaned } {
  // A fragment goes in a body of its own; every parser then reads it the same way.
  const whole = /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html)
  const doc = parse(whole ? html : `<!doctype html><html><head></head><body>${html}</body></html>`)
  const cleaned = clean(doc)
  const head = doc.head
  // Styles written at the top level of the body belong in the head.
  for (const s of [...doc.body.children].filter(e => e.tagName.toLowerCase() === 'style')) head.append(s)
  if (!head.querySelector('meta[charset]')) {
    const meta = doc.createElement('meta')
    meta.setAttribute('charset', 'utf-8')
    head.prepend(meta)
  }
  if (!head.querySelector('meta[name="viewport"]')) {
    const meta = doc.createElement('meta')
    meta.setAttribute('name', 'viewport')
    meta.setAttribute('content', 'width=device-width, initial-scale=1')
    head.querySelector('meta[charset]')?.after(meta)
  }
  let title = head.querySelector('title')
  if (!title) {
    title = doc.createElement('title')
    head.querySelector('meta[name="viewport"]')?.after(title)
  }
  if (!title.textContent?.trim()) title.textContent = name
  // The board's own stylesheets, in this order, before the artboard's own
  // styles so those can override them: tokens.css, then (Tailwind boards) tailwind.css.
  const wanted = [links.tokens, ...(links.tailwind ? [TAILWIND_FILE] : [])]
  for (const l of [...head.querySelectorAll('link[rel~="stylesheet"]')]) {
    const href = l.getAttribute('href')
    if (href === TAILWIND_FILE || href === links.tokens) l.remove()
  }
  const at = head.querySelector('style, link[rel~="stylesheet"]')
  for (const href of wanted) {
    const link = doc.createElement('link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('href', href)
    if (at) at.before(link)
    else head.append(link)
  }
  return { html: serialize(doc), cleaned }
}

/** The board files an artboard links to. */
export type Links = { tokens: string; tailwind: boolean }

/** A Tailwind board's compiled CSS: every class its artboards use (derived, see FORMAT.md). */
export const TAILWIND_FILE = 'tailwind.css'

/** Strip what makes HTML more than a design (see `standalone`). */
export function clean(doc: Document): Cleaned {
  const removed: string[] = []
  for (const el of [...doc.querySelectorAll(DANGEROUS)]) {
    removed.push(`<${el.tagName.toLowerCase()}>`)
    el.remove()
  }
  // <meta http-equiv=refresh> navigates; a stray CSP meta would fight Create's own.
  for (const el of [...doc.querySelectorAll('meta[http-equiv]')]) {
    removed.push(`<meta http-equiv="${el.getAttribute('http-equiv')}">`)
    el.remove()
  }
  let remote = 0
  for (const el of [...doc.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase()
      const v = attr.value.trim().toLowerCase().replace(/[\s\u0000-\u001f]+/g, '')
      if (n.startsWith('on')) {
        removed.push(`${n}=""`)
        el.removeAttribute(attr.name)
      } else if (/^(javascript|vbscript):/.test(v) || (v.startsWith('data:text/html'))) {
        removed.push(`${n}="${v.split(':')[0]}:…"`)
        el.removeAttribute(attr.name)
      } else if (['src', 'srcset', 'href', 'poster'].includes(n) && /^(https?:)?\/\//.test(v) && el.tagName.toLowerCase() !== 'a') {
        remote++
      }
    }
  }
  for (const s of [...doc.querySelectorAll('style')]) if (/url\(\s*['"]?(https?:)?\/\//i.test(s.textContent ?? '') || /@import/i.test(s.textContent ?? '')) remote++
  return { removed, remote }
}

export function serialize(doc: Document): string {
  return `<!doctype html>\n${doc.documentElement.outerHTML}\n`
}

/** The HTML an empty artboard starts from (still to go through `standalone`). */
export function blankArtboard(style: StyleKind): string {
  return style === 'tailwind'
    ? '<body class="m-0 font-sans bg-bg text-text"></body>'
    : '<style>\n  body { margin: 0; font-family: var(--font-sans); background: var(--color-bg); color: var(--color-text); }\n</style>\n'
}
