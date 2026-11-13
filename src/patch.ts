// Changing part of an artboard by CSS selector, so Ava can fix one heading
// without writing the whole page again. Every element the selector matches
// changes; no match is an error that names what is there, so a small model
// can try again with a selector that exists.
import type { ParseHtml } from './format.ts'

export const ACTIONS = [
  'replace', 'set_html', 'set_text', 'append', 'prepend', 'insert_before', 'insert_after',
  'remove', 'set_style', 'set_attribute', 'remove_attribute', 'add_class', 'remove_class',
] as const
export type Action = (typeof ACTIONS)[number]

export type Patch = {
  selector: string
  action: Action
  /** HTML for replace, set_html, append, prepend, insert_before, insert_after. */
  html?: string
  /** Text for set_text. */
  text?: string
  /** CSS declarations for set_style, e.g. `color: red; padding: 24px`. */
  style?: string
  /** For set_attribute / remove_attribute. */
  attribute?: string
  /** For set_attribute; class name(s) for add_class / remove_class. */
  value?: string
}

const NEEDS_HTML: readonly Action[] = ['replace', 'set_html', 'append', 'prepend', 'insert_before', 'insert_after']
const STRUCTURE = new Set(['html', 'head', 'body'])

/** Read a patch from a tool's arguments, leniently: `content` stands in for `html` or `text`. */
export function patchFrom(args: Record<string, unknown>): Patch {
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const selector = s(args.selector)?.trim()
  if (!selector) throw new Error('Give a CSS `selector`, e.g. "#hero h1" or ".pricing .card".')
  const action = s(args.action)?.trim().toLowerCase().replace(/[\s-]+/g, '_') as Action | undefined
  if (!action || !ACTIONS.includes(action)) throw new Error(`\`action\` is one of: ${ACTIONS.join(', ')}.`)
  const content = s(args.content)
  return {
    selector,
    action,
    html: s(args.html) ?? content ?? (action === 'set_text' ? undefined : s(args.text)),
    text: s(args.text) ?? content ?? s(args.html),
    style: s(args.style),
    attribute: s(args.attribute)?.trim(),
    value: s(args.value) ?? (action.endsWith('_class') ? s(args.class) ?? content : content),
  }
}

/** A short list of the ids and classes in a document, to suggest selectors. */
export function selectorsIn(doc: Document, most = 24): string[] {
  const ids: string[] = []
  const classes = new Set<string>()
  const tags = new Set<string>()
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (el.id) ids.push(`#${el.id}`)
    for (const c of el.classList) classes.add(`.${c}`)
    tags.add(el.tagName.toLowerCase())
  }
  return [...ids, ...classes, ...tags].slice(0, most)
}

function fragment(doc: Document, html: string): Node[] {
  const holder = doc.createElement('div')
  holder.innerHTML = html
  return [...holder.childNodes]
}

/** Merge `a: b; c: d` into an element's style attribute (later wins, empty value removes). */
export function mergeStyle(existing: string, add: string): string {
  const decls = new Map<string, string>()
  const read = (css: string) => {
    for (const d of css.split(';')) {
      const at = d.indexOf(':')
      if (at < 0) continue
      const k = d.slice(0, at).trim().toLowerCase()
      const v = d.slice(at + 1).trim()
      if (!k) continue
      if (v) decls.set(k, v)
      else decls.delete(k)
    }
  }
  read(existing)
  read(add)
  return [...decls].map(([k, v]) => `${k}: ${v}`).join('; ')
}

/** Apply a patch to a parsed document in place. Returns how many elements changed. */
export function applyPatch(doc: Document, p: Patch): number {
  let found: Element[]
  try {
    found = [...doc.querySelectorAll(p.selector)]
  } catch {
    throw new Error(`“${p.selector}” isn't a CSS selector.`)
  }
  if (!found.length) {
    const some = selectorsIn(doc)
    throw new Error(`Nothing matches “${p.selector}”.${some.length ? ` Selectors that exist: ${some.join(', ')}.` : ' The artboard is empty: use write_artboard.'}`)
  }
  if (NEEDS_HTML.includes(p.action) && p.html === undefined) throw new Error(`${p.action} needs the new HTML in \`html\`.`)
  for (const el of found) {
    const tag = el.tagName.toLowerCase()
    if (STRUCTURE.has(tag) && ['replace', 'remove', 'insert_before', 'insert_after'].includes(p.action)) {
      throw new Error(`Can't ${p.action.replace('_', ' ')} <${tag}>: use set_html on body, or write_artboard for the whole page.`)
    }
    switch (p.action) {
      case 'replace': el.replaceWith(...fragment(doc, p.html!)); break
      case 'set_html': el.innerHTML = p.html!; break
      case 'set_text':
        if (p.text === undefined) throw new Error('set_text needs the new words in `text`.')
        el.textContent = p.text
        break
      case 'append': el.append(...fragment(doc, p.html!)); break
      case 'prepend': el.prepend(...fragment(doc, p.html!)); break
      case 'insert_before': el.before(...fragment(doc, p.html!)); break
      case 'insert_after': el.after(...fragment(doc, p.html!)); break
      case 'remove': el.remove(); break
      case 'set_style': {
        if (!p.style?.trim()) throw new Error('set_style needs CSS declarations in `style`, e.g. "color: #333; padding: 24px".')
        const merged = mergeStyle(el.getAttribute('style') ?? '', p.style)
        if (merged) el.setAttribute('style', merged)
        else el.removeAttribute('style')
        break
      }
      case 'set_attribute':
        if (!p.attribute) throw new Error('set_attribute needs the attribute name in `attribute`.')
        el.setAttribute(p.attribute, p.value ?? '')
        break
      case 'remove_attribute':
        if (!p.attribute) throw new Error('remove_attribute needs the attribute name in `attribute`.')
        el.removeAttribute(p.attribute)
        break
      case 'add_class':
      case 'remove_class': {
        const names = (p.value ?? '').split(/\s+/).filter(Boolean)
        if (!names.length) throw new Error(`${p.action} needs the class name(s) in \`value\`.`)
        if (p.action === 'add_class') el.classList.add(...names)
        else el.classList.remove(...names)
        break
      }
    }
  }
  return found.length
}

/** Parse, patch, and hand back the document (still to be cleaned and serialized). */
export function patchHtml(html: string, p: Patch, parse: ParseHtml): { doc: Document; changed: number } {
  const doc = parse(html)
  const changed = applyPatch(doc, p)
  return { doc, changed }
}
