// patch_artboard: the effect on the document each action has.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import { Board } from '../src/board.ts'
import { mergeStyle, patchFrom } from '../src/patch.ts'
import type { ParseHtml } from '../src/format.ts'

const parse: ParseHtml = html => new DOMParser().parseFromString(html, 'text/html') as unknown as Document

function board(html: string) {
  const b = Board.empty(parse)
  b.create({ name: 'Home', html })
  const patch = (args: Record<string, unknown>) => b.patch('home', patchFrom(args))
  const q = (sel: string) => parse(b.get('home').html).querySelectorAll(sel)
  return { b, patch, q }
}

const PAGE = '<header id="nav"><a class="logo">Crumb</a></header><main><section id="hero"><h1>Old</h1><p class="lead">Lead</p></section><ul class="list"><li>1</li><li>2</li></ul></main>'

test('set_text changes the words and nothing else', () => {
  const { patch, q } = board(PAGE)
  const r = patch({ selector: '#hero h1', action: 'set_text', text: 'Fresh <b>bread</b>' }).report
  assert.equal(r.matched, 1)
  assert.deepEqual(r.changes, [{ selector: 'h1', element: 'h1 “Old”', before: 'Old', after: 'Fresh <b>bread</b>' }])
  assert.equal(q('#hero h1')[0].textContent, 'Fresh <b>bread</b>', 'text is text, never markup')
  assert.equal(q('#hero b').length, 0)
  assert.equal(q('.lead')[0].textContent, 'Lead')
})

test('replace, append, prepend, insert_before/after and remove change the tree', () => {
  const { patch, q } = board(PAGE)
  patch({ selector: '.lead', action: 'replace', html: '<p class="sub">New</p><a class="btn">Go</a>' })
  assert.equal(q('.lead').length, 0)
  assert.deepEqual([...q('#hero > *')].map(e => e.tagName.toLowerCase()), ['h1', 'p', 'a'])
  patch({ selector: '.list', action: 'append', html: '<li>3</li>' })
  patch({ selector: '.list', action: 'prepend', html: '<li>0</li>' })
  assert.deepEqual([...q('.list li')].map(e => e.textContent), ['0', '1', '2', '3'])
  patch({ selector: '#hero', action: 'insert_after', html: '<section id="features"></section>' })
  patch({ selector: '#hero', action: 'insert_before', html: '<div id="banner"></div>' })
  assert.deepEqual([...q('main > *')].map(e => e.id || e.className), ['banner', 'hero', 'features', 'list'])
  patch({ selector: '#banner', action: 'remove' })
  assert.equal(q('#banner').length, 0)
})

test('a style for several matches changes every one, and the answer lists each before and after', () => {
  const { patch, q } = board(PAGE)
  const r = patch({ selector: '.list li', action: 'set_style', style: 'color: red' }).report
  assert.deepEqual([...q('.list li')].map(e => e.getAttribute('style')), ['color: red', 'color: red'])
  assert.equal(r.matched, 2)
  assert.deepEqual(r.changes.map(c => [c.selector, c.element, c.before, c.after]), [
    ['ul.list > li:nth-of-type(1)', 'li “1”', '', 'color: red'],
    ['ul.list > li:nth-of-type(2)', 'li “2”', '', 'color: red'],
  ])
})

// The live run (avacanada/ava#53): Qwen3.5 4B set every nav link to "Home Menu
// Contact" and every paragraph to one sentence, because its selector matched many.
const BAKERY = '<header><nav><a href="#">Home</a><a href="#">Menu</a><a href="#">Contact</a></nav></header>' +
  '<section class="hero"><p>Fresh bread every morning.</p></section>' +
  '<section class="features"><div><p>Sourdough</p></div><div><p>Pastries</p></div><div><p>Coffee</p></div></section>'

test('set_text on a selector that matches several elements changes nothing, and names each one', () => {
  const { b, patch, q } = board(BAKERY)
  const before = b.get('home').html
  let message = ''
  assert.throws(() => patch({ selector: 'header nav a', action: 'set_text', text: 'Home Menu Contact' }), (e: Error) => { message = e.message; return true })
  assert.equal(b.get('home').html, before, 'the page is untouched')
  assert.deepEqual([...q('nav a')].map(a => a.textContent), ['Home', 'Menu', 'Contact'])
  assert.match(message, /matches 3 elements/)
  assert.match(message, /all: true/)
  // Each selector it offers matches exactly the element it names.
  const list = message.split('just that one: ')[1]?.split('. Only if')[0] ?? ''
  const offered = list.split('; ').map(item => item.match(/^(.+) \(a “(\w+)”\)$/)).map(m => [m?.[1] ?? '', m?.[2] ?? ''])
  assert.deepEqual(offered.map(o => o[0]), ['nav > a:nth-of-type(1)', 'nav > a:nth-of-type(2)', 'nav > a:nth-of-type(3)'], message)
  for (const [sel, words] of offered) {
    const hit = q(sel)
    assert.equal(hit.length, 1, sel)
    assert.equal(hit[0].textContent, words, sel)
  }
  // Using one of them changes that link alone.
  patch({ selector: offered[1][0], action: 'set_text', text: 'Our menu' })
  assert.deepEqual([...q('nav a')].map(a => a.textContent), ['Home', 'Our menu', 'Contact'])
})

test('the paragraphs keep their own copy: set_html, replace and remove on many are refused too', () => {
  const { b, patch, q } = board(BAKERY)
  const before = b.get('home').html
  for (const action of ['set_text', 'set_html', 'replace', 'remove']) {
    assert.throws(() => patch({ selector: 'section p', action, text: 'Same sentence.', html: '<p>Same sentence.</p>' }), /matches 4 elements/, action)
  }
  assert.equal(b.get('home').html, before)
  assert.deepEqual([...q('p')].map(p => p.textContent), ['Fresh bread every morning.', 'Sourdough', 'Pastries', 'Coffee'])
})

test('all: true changes every match when that is what the call means', () => {
  const { patch, q } = board(BAKERY)
  const r = patch({ selector: '.features p', action: 'set_text', text: 'Soon', all: true }).report
  assert.equal(r.matched, 3)
  assert.deepEqual([...q('.features p')].map(p => p.textContent), ['Soon', 'Soon', 'Soon'])
  assert.deepEqual(r.changes.map(c => [c.before, c.after]), [['Sourdough', 'Soon'], ['Pastries', 'Soon'], ['Coffee', 'Soon']])
  assert.equal(patchFrom({ selector: 'p', action: 'remove', all: 'true' }).all, true)
  assert.equal(patchFrom({ selector: 'p', action: 'remove' }).all, false)
})

test('a removal reports what went, and a no-op says nothing changed', () => {
  const { patch, q } = board(BAKERY)
  const gone = patch({ selector: '.hero p', action: 'remove' }).report
  assert.equal(q('.hero p').length, 0)
  assert.deepEqual(gone.changes, [{ selector: 'section.hero > p', element: 'p “Fresh bread every morning.”', before: '<p>Fresh bread every morning.</p>', after: null }])
  assert.equal(gone.unchanged, false)
  assert.equal(patch({ selector: 'nav a:first-child', action: 'set_text', text: 'Home' }).report.unchanged, true)
})

test('undo puts the HTML back one change at a time, writes included, and says when there is nothing left', () => {
  const { b, patch, q } = board(BAKERY)
  const first = b.get('home').html
  assert.equal(b.undoable('home'), 0)
  assert.throws(() => b.undo('home'), /Nothing to undo/)
  patch({ selector: '.hero p', action: 'set_text', text: 'Wrong' })
  const second = b.get('home').html
  b.write('Home', '<h1>Gone</h1>')
  assert.equal(q('p').length, 0)
  assert.equal(b.undoable('home'), 2)
  assert.equal(b.undo('home').left, 1)
  assert.equal(b.get('home').html, second)
  assert.equal(q('.hero p')[0].textContent, 'Wrong')
  assert.equal(b.undo('Home').left, 0)
  assert.equal(b.get('home').html, first)
  assert.throws(() => b.undo('home'), /Nothing to undo/)
})

test('a refused patch leaves nothing to undo; an undo is stored like any change', () => {
  const { b, patch } = board(BAKERY)
  assert.throws(() => patch({ selector: 'p', action: 'set_text', text: 'x' }))
  assert.equal(b.undoable('home'), 0)
  patch({ selector: '.hero p', action: 'set_text', text: 'x' })
  const wrote: string[] = []
  b.onChange(c => wrote.push(...c.wrote))
  b.undo('home')
  assert.deepEqual(wrote, ['home.html'])
})

test('set_style merges declarations; an empty value takes one out', () => {
  assert.equal(mergeStyle('color: red; padding: 4px', 'padding: 8px; margin: 0'), 'color: red; padding: 8px; margin: 0')
  assert.equal(mergeStyle('color: red; padding: 4px', 'color:'), 'padding: 4px')
  const { patch, q } = board('<p id="p" style="color: red">x</p>')
  patch({ selector: '#p', action: 'set_style', style: 'font-size: 20px' })
  assert.equal(q('#p')[0].getAttribute('style'), 'color: red; font-size: 20px')
})

test('attributes and classes', () => {
  const { patch, q } = board('<a id="a" class="btn">x</a>')
  patch({ selector: '#a', action: 'set_attribute', attribute: 'title', value: 'Go' })
  patch({ selector: '#a', action: 'add_class', value: 'big primary' })
  patch({ selector: '#a', action: 'remove_class', value: 'btn' })
  const a = q('#a')[0]
  assert.equal(a.getAttribute('title'), 'Go')
  assert.deepEqual([...a.classList].sort(), ['big', 'primary'])
  patch({ selector: '#a', action: 'remove_attribute', attribute: 'title' })
  assert.equal(q('#a')[0].hasAttribute('title'), false)
})

test('a patch can not smuggle in a script or handler', () => {
  const { patch, q } = board(PAGE)
  const r = patch({ selector: '#hero', action: 'append', html: '<script>alert(1)</script><img src="a.png" onload="x()">' })
  assert.equal(q('script').length, 0)
  assert.equal(q('img')[0].hasAttribute('onload'), false)
  assert.ok(r.cleaned.removed.includes('<script>'))
  patch({ selector: '.logo', action: 'set_attribute', attribute: 'onclick', value: 'x()' })
  assert.equal(q('.logo')[0].hasAttribute('onclick'), false)
})

test('no match is an error that lists selectors that exist, and changes nothing', () => {
  const { b, patch } = board(PAGE)
  const before = b.get('home').html
  assert.throws(() => patch({ selector: '#pricing', action: 'remove' }), (e: Error) => /#nav/.test(e.message) && /#hero/.test(e.message) && /\.lead/.test(e.message))
  assert.throws(() => patch({ selector: '###', action: 'remove' }), /isn't a CSS selector/)
  assert.equal(b.get('home').html, before)
})

test('the page frame can not be removed or replaced, only refilled', () => {
  const { patch, q } = board(PAGE)
  assert.throws(() => patch({ selector: 'body', action: 'remove' }), /set_html on body/)
  patch({ selector: 'body', action: 'set_html', html: '<h1 id="t">New page</h1>' })
  assert.equal(q('#t').length, 1)
  assert.equal(q('link[href="tokens.css"]').length, 1, 'still linked to the tokens')
})

test('lenient arguments: content for html or text, action spelled loosely; a bad action is named', () => {
  assert.equal(patchFrom({ selector: 'h1', action: 'set text', content: 'Hi' }).text, 'Hi')
  assert.equal(patchFrom({ selector: 'h1', action: 'Set-HTML', content: '<b>x</b>' }).html, '<b>x</b>')
  assert.throws(() => patchFrom({ selector: 'h1', action: 'explode' }), /set_text/)
  assert.throws(() => patchFrom({ action: 'remove' }), /selector/)
})
