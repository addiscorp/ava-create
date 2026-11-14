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
  assert.equal(patch({ selector: '#hero h1', action: 'set_text', text: 'Fresh <b>bread</b>' }).changed, 1)
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

test('every match changes, and the count says so', () => {
  const { patch, q } = board(PAGE)
  assert.equal(patch({ selector: '.list li', action: 'set_style', style: 'color: red' }).changed, 2)
  assert.deepEqual([...q('.list li')].map(e => e.getAttribute('style')), ['color: red', 'color: red'])
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
