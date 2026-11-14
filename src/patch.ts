// Changing part of an artboard by CSS selector, so Ava can fix one heading
// without writing the whole page again. A small model's selector often
// matches more than it means (`section p` is every paragraph), so:
// - no match is an error that names what is there;
// - several matches with one new text, HTML or a removal is refused unless
//   the call says `all: true`, and the refusal lists a selector for each match;
// - every answer says what matched and what each change was, before → after.
import { unescapeHtml, type ParseHtml } from './format.ts'

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
  /** The call means every match, even for an action that would make them all the same. */
  all?: boolean
}

/** One element the selector matched: a selector for it alone, and what it is (tag and words). */
export type Match = { selector: string; element: string }

/** What one element was and is, in the part the action changes (null: it's gone). */
export type Changed = Match & { before: string; after: string | null }

export type Report = {
  /** How many elements the selector matched (all of them changed). */
  matched: number
  /** Each match, before → after; the first MAX_LISTED of them. */
  changes: Changed[]
  /** True when no element's changed part is any different. */
  unchanged: boolean
}

const NEEDS_HTML: readonly Action[] = ['replace', 'set_html', 'append', 'prepend', 'insert_before', 'insert_after']
/** Actions that make every match the same, or take them away: one match only, unless `all`. */
export const ONE_ONLY: readonly Action[] = ['set_text', 'set_html', 'replace', 'remove']
const STRUCTURE = new Set(['html', 'head', 'body'])
export const MAX_LISTED = 12
const SNIPPET = 120

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
    all: args.all === true || (typeof args.all === 'string' && args.all.trim().toLowerCase() === 'true'),
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

const IDENT = /^-?[_a-zA-Z][\w-]*$/
const onlyThis = (doc: Document, sel: string, el: Element) => {
  try {
    const all = doc.querySelectorAll(sel)
    return all.length === 1 && all[0] === el
  } catch {
    return false
  }
}

/**
 * A selector that matches this element and no other: its id, its tag and
 * classes, or a short `>` path with :nth-of-type where siblings share a tag.
 */
export function selectorFor(doc: Document, el: Element): string {
  if (el.id && IDENT.test(el.id) && onlyThis(doc, `#${el.id}`, el)) return `#${el.id}`
  const tag = el.tagName.toLowerCase()
  const classes = [...el.classList].filter(c => IDENT.test(c))
  if (classes.length) {
    const sel = `${tag}.${classes.join('.')}`
    if (onlyThis(doc, sel, el)) return sel
  }
  const steps: string[] = []
  let at: Element | null = el
  while (at && at !== doc.documentElement) {
    const t = at.tagName.toLowerCase()
    if (at !== el && at.id && IDENT.test(at.id) && onlyThis(doc, `#${at.id}`, at)) {
      steps.unshift(`#${at.id}`)
      break
    }
    if (t === 'body') { steps.unshift('body'); break }
    const step = stepFor(at)
    steps.unshift(step)
    const sel = steps.join(' > ')
    // `a:nth-of-type(2)` alone is true but says little: give it its parent too.
    if ((steps.length > 1 || !step.includes(':')) && onlyThis(doc, sel, el)) return sel
    at = at.parentElement
  }
  return steps.join(' > ')
}

/** One step of a path: the tag, with its classes or its place among same-tag siblings when needed. */
function stepFor(el: Element): string {
  const t = el.tagName.toLowerCase()
  const same = el.parentElement ? [...el.parentElement.children].filter(c => c.tagName === el.tagName) : [el]
  if (same.length === 1) {
    const classes = [...el.classList].filter(c => IDENT.test(c))
    return classes.length ? `${t}.${classes.join('.')}` : t
  }
  const classes = [...el.classList].filter(c => IDENT.test(c))
  const cls = classes.length ? `.${classes.join('.')}` : ''
  if (cls && same.filter(s => classes.every(c => s.classList.contains(c))).length === 1) return `${t}${cls}`
  return `${t}:nth-of-type(${same.indexOf(el) + 1})`
}

const squash = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > SNIPPET ? `${one.slice(0, SNIPPET - 1)}…` : one
}

/** What an element is, said short: `a “Home”`, `p.lead “Fresh bread every…”`, `img`. */
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const cls = [...el.classList].slice(0, 2).map(c => `.${c}`).join('')
  const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const said = words.length > 40 ? `${words.slice(0, 39)}…` : words
  return `${tag}${el.id ? `#${el.id}` : cls}${said ? ` “${said}”` : ''}`
}

/** The part of an element an action changes, as text to show before and after. */
function aspect(el: Element, p: Patch): string {
  switch (p.action) {
    case 'set_text': return el.textContent ?? ''
    case 'set_html': case 'append': case 'prepend': return el.innerHTML
    case 'replace': case 'remove': case 'insert_before': case 'insert_after': return el.outerHTML
    case 'set_style': return el.getAttribute('style') ?? ''
    case 'set_attribute': case 'remove_attribute': return el.getAttribute(p.attribute ?? '') ?? ''
    case 'add_class': case 'remove_class': return el.getAttribute('class') ?? ''
  }
}

function fragment(doc: Document, html: string): Node[] {
  const holder = doc.createElement('div')
  holder.innerHTML = unescapeHtml(html)
  return [...holder.childNodes]
}

const outer = (nodes: Node[]) => nodes.map(n => (n as Element).outerHTML ?? n.textContent ?? '').join('')

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

/** Apply a patch to a parsed document in place, and say what it matched and changed. */
export function applyPatch(doc: Document, p: Patch): Report {
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
  if (p.action === 'set_text' && p.text === undefined) throw new Error('set_text needs the new words in `text`.')
  // Selectors for the matches, taken before anything moves.
  const matches: Match[] = found.map(el => ({ selector: selectorFor(doc, el), element: describe(el) }))
  if (found.length > 1 && ONE_ONLY.includes(p.action) && !p.all) {
    const what = p.action === 'remove' ? 'remove all of them' : `give all of them the same ${p.action === 'set_text' ? 'text' : 'HTML'}`
    const list = matches.slice(0, MAX_LISTED).map(m => `${m.selector} (${m.element})`).join('; ')
    const more = found.length > MAX_LISTED ? `; and ${found.length - MAX_LISTED} more` : ''
    throw new Error(
      `Nothing changed: “${p.selector}” matches ${found.length} elements, and ${p.action} would ${what}. ` +
      `Change one at a time, with a selector for just that one: ${list}${more}. ` +
      `Only if you really mean every one of them, call again with all: true.`,
    )
  }
  const changes: Changed[] = []
  found.forEach((el, i) => {
    const tag = el.tagName.toLowerCase()
    if (STRUCTURE.has(tag) && ['replace', 'remove', 'insert_before', 'insert_after'].includes(p.action)) {
      throw new Error(`Can't ${p.action.replace('_', ' ')} <${tag}>: use set_html on body, or write_artboard for the whole page.`)
    }
    const before = aspect(el, p)
    let after: string | null | undefined
    switch (p.action) {
      case 'replace': { const nodes = fragment(doc, p.html!); el.replaceWith(...nodes); after = outer(nodes); break }
      case 'set_html': el.innerHTML = p.html!; break
      case 'set_text': el.textContent = p.text!; break
      case 'append': el.append(...fragment(doc, p.html!)); break
      case 'prepend': el.prepend(...fragment(doc, p.html!)); break
      case 'insert_before': { const nodes = fragment(doc, p.html!); el.before(...nodes); after = outer(nodes) + el.outerHTML; break }
      case 'insert_after': { const nodes = fragment(doc, p.html!); el.after(...nodes); after = el.outerHTML + outer(nodes); break }
      case 'remove': el.remove(); after = null; break
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
    if (after === undefined) after = aspect(el, p)
    changes.push({ ...matches[i], before, after })
  })
  return {
    matched: found.length,
    changes: changes.slice(0, MAX_LISTED).map(c => ({ ...c, before: squash(c.before), after: c.after === null ? null : squash(c.after) })),
    unchanged: changes.every(c => c.after === c.before),
  }
}

/** Parse, patch, and hand back the document (still to be cleaned and serialized). */
export function patchHtml(html: string, p: Patch, parse: ParseHtml): { doc: Document; report: Report } {
  const doc = parse(html)
  const report = applyPatch(doc, p)
  return { doc, report }
}
