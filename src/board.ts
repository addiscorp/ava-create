// The board in memory: a thin layer over its files (format.ts). Every change
// says which files it touched, and `files()` is the whole board as the format
// stores it, so saving, importing and exporting are copying files.
import {
  BOARD_FILE, FORMAT_VERSION, STARTER_TOKENS, TAILWIND_FILE, TOKENS_FILE, blankArtboard, fileFor, parseBoardJson, parseTokens,
  serialize, side, standalone, tokenName, tokenValue, writeBoardJson, writeTokens,
  type ArtboardEntry, type BoardJson, type Cleaned, type Links, type ParseHtml, type StyleKind, type Tokens,
} from './format.ts'
import { patchHtml, type Patch } from './patch.ts'

export type Artboard = ArtboardEntry & { html: string }

/** Its id is its file without `.html`: what Ava names it by. */
export const idOf = (a: { file: string }) => a.file.replace(/\.html$/, '')

export type Change = {
  /** Files written (paths relative to the board). */
  wrote: string[]
  /** Files that are gone. */
  removed: string[]
  /** The artboard it was about, if one. */
  artboard?: string
}

export type Place = { name?: string; x?: number; y?: number; width?: number; height?: number }

const GAP = 120

export class Board {
  name: string
  style: StyleKind
  private meta: Omit<BoardJson, 'artboards' | 'version' | 'name' | 'style' | 'tokens'>
  private tokensFile: string
  private tokenMap: Tokens
  private boards: Artboard[]
  private listeners: ((c: Change) => void)[] = []
  private parse: ParseHtml

  private constructor(parse: ParseHtml, json: BoardJson, tokens: Tokens, boards: Artboard[]) {
    const { artboards: _a, version: _v, name, style, tokens: tokensFile, ...meta } = json
    this.parse = parse
    this.name = name
    this.style = style
    this.meta = meta
    this.tokensFile = tokensFile
    this.tokenMap = tokens
    this.boards = boards
  }

  static empty(parse: ParseHtml, name = 'Board', style: StyleKind = 'css'): Board {
    const b = new Board(parse, { version: FORMAT_VERSION, name, style, tokens: TOKENS_FILE, artboards: [] }, { ...STARTER_TOKENS }, [])
    b.isNew = true
    return b
  }

  /** Made here and never saved: nothing of it is on disk yet. */
  private isNew = false

  /**
   * A board from its files (`read` gives a file's text, or null if it isn't
   * there). An artboard whose file is missing comes back blank, not dropped.
   */
  static async load(parse: ParseHtml, read: (path: string) => Promise<string | null>): Promise<Board> {
    const text = await read(BOARD_FILE)
    if (text === null) return Board.empty(parse)
    const json = parseBoardJson(text)
    const css = await read(json.tokens)
    const boards: Artboard[] = []
    const links: Links = { tokens: json.tokens, tailwind: json.style === 'tailwind' }
    for (const e of json.artboards) {
      const html = await read(e.file)
      boards.push({ ...e, html: html ?? standalone(blankArtboard(json.style), e.name, parse, links).html })
    }
    const board = new Board(parse, json, css === null ? {} : parseTokens(css), boards)
    if (json.style === 'tailwind') board.compiled = (await read(TAILWIND_FILE)) ?? ''
    return board
  }

  /** A Tailwind board's compiled CSS (tailwind.css), kept by whoever compiles it. */
  compiled = ''

  links(): Links {
    return { tokens: this.tokensFile, tailwind: this.style === 'tailwind' }
  }

  /** Set tailwind.css (a Tailwind board's compiled classes). */
  setCompiled(css: string) {
    if (this.style !== 'tailwind' || css === this.compiled) return
    this.compiled = css
    this.emit({ wrote: [TAILWIND_FILE], removed: [] })
  }

  /**
   * Switch how the artboards are styled. Their HTML stays as it is (a CSS
   * board's `<style>` still works under Tailwind; Tailwind classes do nothing
   * in a CSS board), and each one's links to the board's stylesheets follow.
   */
  setStyle(style: StyleKind) {
    if (style === this.style) return
    this.style = style
    if (style === 'css') this.compiled = ''
    for (const a of this.boards) a.html = standalone(a.html, a.name, this.parse, this.links()).html
    this.emit({
      wrote: [BOARD_FILE, ...this.boards.map(a => a.file)],
      removed: style === 'css' ? [TAILWIND_FILE] : [],
    })
  }

  static fromFiles(parse: ParseHtml, files: Map<string, string>): Promise<Board> {
    return Board.load(parse, async p => files.get(p) ?? null)
  }

  onChange(fn: (c: Change) => void): () => void {
    this.listeners.push(fn)
    return () => { this.listeners = this.listeners.filter(f => f !== fn) }
  }

  private emit(c: Change) {
    // A new board isn't on disk yet: its first change writes every file (tokens.css too).
    if (this.isNew) {
      this.isNew = false
      c = { ...c, wrote: [...new Set([...c.wrote, ...this.files().keys()])] }
    }
    for (const fn of this.listeners) fn(c)
  }

  // ---- Files (the format) ----

  json(): BoardJson {
    return {
      version: FORMAT_VERSION,
      name: this.name,
      style: this.style,
      tokens: this.tokensFile,
      ...this.meta,
      artboards: this.boards.map(({ html: _h, ...e }) => e),
    }
  }

  /** Every file of the board, path → text. */
  files(): Map<string, string> {
    const out = new Map<string, string>()
    out.set(BOARD_FILE, writeBoardJson(this.json()))
    out.set(this.tokensFile, this.tokensCss())
    if (this.style === 'tailwind') out.set(TAILWIND_FILE, this.compiled)
    for (const a of this.boards) out.set(a.file, a.html)
    return out
  }

  tokensCss(): string {
    return writeTokens(this.tokenMap)
  }

  get tokensPath(): string {
    return this.tokensFile
  }

  // ---- Reading ----

  list(): Artboard[] {
    return [...this.boards]
  }

  /** By id (`home`), file (`home.html`) or name (`Home`, any case). */
  find(ref: string): Artboard | undefined {
    const r = ref.trim()
    const low = r.toLowerCase()
    return this.boards.find(a => idOf(a) === r || a.file === r)
      ?? this.boards.find(a => a.name.toLowerCase() === low)
      ?? this.boards.find(a => idOf(a) === low || a.file === low)
  }

  get(ref: string): Artboard {
    const a = this.find(ref)
    if (!a) {
      const have = this.boards.map(b => `${idOf(b)} (“${b.name}”)`).join(', ')
      throw new Error(`There's no artboard “${ref}”.${have ? ` The artboards are: ${have}.` : ' The board is empty: make one with new_artboard.'}`)
    }
    return a
  }

  tokens(): Tokens {
    return { ...this.tokenMap }
  }

  // ---- Changing ----

  /** Where a new artboard goes by default: right of the rightmost one, top-aligned. */
  nextSpot(): { x: number; y: number } {
    if (!this.boards.length) return { x: 0, y: 0 }
    const right = Math.max(...this.boards.map(a => a.x + a.width))
    const top = Math.min(...this.boards.map(a => a.y))
    return { x: right + GAP, y: top }
  }

  create(p: Place & { html?: string }): { artboard: Artboard; cleaned: Cleaned } {
    const name = p.name?.trim() || `Artboard ${this.boards.length + 1}`
    const file = fileFor(name, this.boards.map(a => a.file).concat(this.tokensFile, BOARD_FILE))
    const spot = this.nextSpot()
    const made = standalone(p.html?.trim() ? p.html : blankArtboard(this.style), name, this.parse, this.links())
    const a: Artboard = {
      file,
      name,
      x: Math.round(p.x ?? spot.x),
      y: Math.round(p.y ?? spot.y),
      width: side(p.width ?? 1440),
      height: side(p.height ?? 1024),
      html: made.html,
    }
    this.boards.push(a)
    this.emit({ wrote: [file, BOARD_FILE], removed: [], artboard: idOf(a) })
    return { artboard: a, cleaned: made.cleaned }
  }

  write(ref: string, html: string): { artboard: Artboard; cleaned: Cleaned } {
    const a = this.get(ref)
    const made = standalone(html, a.name, this.parse, this.links())
    a.html = made.html
    this.emit({ wrote: [a.file], removed: [], artboard: idOf(a) })
    return { artboard: a, cleaned: made.cleaned }
  }

  patch(ref: string, p: Patch): { artboard: Artboard; changed: number; cleaned: Cleaned } {
    const a = this.get(ref)
    const { doc, changed } = patchHtml(a.html, p, this.parse)
    const made = standalone(serialize(doc), a.name, this.parse, this.links())
    a.html = made.html
    this.emit({ wrote: [a.file], removed: [], artboard: idOf(a) })
    return { artboard: a, changed, cleaned: made.cleaned }
  }

  /** Rename, move or resize. The file keeps its name, so links to it hold. */
  place(ref: string, p: Place): Artboard {
    const a = this.get(ref)
    if (p.name !== undefined && p.name.trim()) a.name = p.name.trim()
    if (p.x !== undefined && Number.isFinite(p.x)) a.x = Math.round(p.x)
    if (p.y !== undefined && Number.isFinite(p.y)) a.y = Math.round(p.y)
    if (p.width !== undefined && Number.isFinite(p.width)) a.width = side(p.width)
    if (p.height !== undefined && Number.isFinite(p.height)) a.height = side(p.height)
    this.emit({ wrote: [BOARD_FILE], removed: [], artboard: idOf(a) })
    return a
  }

  remove(ref: string): Artboard {
    const a = this.get(ref)
    this.boards = this.boards.filter(b => b !== a)
    this.emit({ wrote: [BOARD_FILE], removed: [a.file], artboard: idOf(a) })
    return a
  }

  /**
   * Set tokens: `{ "--brand": "#0a7", "radius": "8px" }`. An empty or null
   * value removes one. Every name and value is checked before any is set.
   */
  setTokens(changes: Record<string, unknown>): { set: string[]; removed: string[] } {
    const plan: [string, string | null][] = []
    for (const [k, v] of Object.entries(changes)) {
      const name = tokenName(k)
      if (!name) throw new Error(`“${k}” can't be a token name: use letters, digits, - and _, like --color-brand.`)
      if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) { plan.push([name, null]); continue }
      const value = tokenValue(typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '')
      if (!value) throw new Error(`The value for ${name} must be one CSS value (no ; { } < >), e.g. "#0a7" or "16px".`)
      plan.push([name, value])
    }
    if (!plan.length) throw new Error('Give the tokens to set in `tokens`, e.g. { "--color-accent": "#e4572e" }.')
    const set: string[] = []
    const removed: string[] = []
    for (const [name, value] of plan) {
      if (value === null) {
        if (name in this.tokenMap) { delete this.tokenMap[name]; removed.push(name) }
      } else {
        this.tokenMap[name] = value
        set.push(name)
      }
    }
    this.emit({ wrote: [this.tokensFile], removed: [] })
    return { set, removed }
  }
}
