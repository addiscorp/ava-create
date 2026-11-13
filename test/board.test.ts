// The board format and model: what a board's files say after each change,
// read back through the same parser a browser would use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import { Board, idOf } from '../src/board.ts'
import { BOARD_FILE, parseBoardJson, parseTokens, standalone, writeBoardJson, type ParseHtml } from '../src/format.ts'

const parse: ParseHtml = html => new DOMParser().parseFromString(html, 'text/html') as unknown as Document
const doc = (html: string) => parse(html)

test('a new artboard is a standalone document that links tokens.css, listed in board.json', async () => {
  const b = Board.empty(parse)
  const { artboard } = b.create({ name: 'Home Page', width: 1200, height: 800, html: '<section id="hero"><h1>Hi</h1></section>' })
  assert.equal(artboard.file, 'home-page.html')
  const files = b.files()
  const d = doc(files.get('home-page.html')!)
  assert.equal(d.querySelector('title')?.textContent, 'Home Page')
  assert.ok(d.querySelector('meta[charset]'))
  assert.equal(d.querySelector('link[rel="stylesheet"]')?.getAttribute('href'), 'tokens.css')
  assert.equal(d.querySelector('#hero h1')?.textContent, 'Hi')
  const json = parseBoardJson(files.get(BOARD_FILE)!)
  assert.deepEqual(json.artboards.map(a => [a.file, a.name, a.x, a.y, a.width, a.height]), [['home-page.html', 'Home Page', 0, 0, 1200, 800]])
  assert.equal(json.style, 'css')
  assert.equal(json.tokens, 'tokens.css')
  assert.ok('--color-accent' in parseTokens(files.get('tokens.css')!), 'a new board starts with tokens')
})

test('artboards line up left to right, names never collide on file', () => {
  const b = Board.empty(parse)
  b.create({ name: 'Page', width: 1000, height: 500 })
  const second = b.create({ name: 'Page', width: 400, height: 300 }).artboard
  assert.equal(second.file, 'page-2.html')
  assert.equal(second.x, 1000 + 120)
  assert.equal(second.y, 0)
  assert.equal(b.find('page-2'), second)
  assert.equal(b.find('PAGE')?.file, 'page.html', 'a name finds the first artboard with it')
})

test('a board survives a round trip through its files, unknown fields included', async () => {
  const b = Board.empty(parse, 'Bakery')
  b.create({ name: 'Home', html: '<p class="lead">Fresh bread</p>' })
  b.create({ name: 'Menu', x: 50, y: 2000, width: 390, height: 844 })
  b.setTokens({ '--color-accent': '#d2691e', brand: 'Crumb' })
  const files = b.files()
  // Another tool added fields; a reader keeps them.
  const json = JSON.parse(files.get(BOARD_FILE)!)
  json.generator = 'someone else'
  json.artboards[1].notes = 'mobile'
  files.set(BOARD_FILE, JSON.stringify(json))
  const back = await Board.fromFiles(parse, files)
  assert.equal(back.name, 'Bakery')
  assert.deepEqual(back.list().map(a => [idOf(a), a.x, a.y, a.width, a.height]), [['home', 0, 0, 1440, 1024], ['menu', 50, 2000, 390, 844]])
  assert.equal(doc(back.get('home').html).querySelector('.lead')?.textContent, 'Fresh bread')
  assert.equal(back.tokens()['--color-accent'], '#d2691e')
  assert.equal(back.tokens()['--brand'], 'Crumb')
  const again = JSON.parse(back.files().get(BOARD_FILE)!)
  assert.equal(again.generator, 'someone else')
  assert.equal(again.artboards[1].notes, 'mobile')
})

test('scripts, handlers, frames and javascript: URLs never reach an artboard file', () => {
  const b = Board.empty(parse)
  const { artboard, cleaned } = b.create({
    name: 'X',
    html: '<img src="x.png" onerror="alert(1)"><a href="javascript:alert(2)">a</a><script>alert(3)</script><iframe src="https://e.com"></iframe><meta http-equiv="refresh" content="0;url=https://e.com"><p onclick="x()">ok</p>',
  })
  const d = doc(artboard.html)
  assert.equal(d.querySelectorAll('script, iframe, meta[http-equiv]').length, 0)
  assert.equal(d.querySelector('img')?.hasAttribute('onerror'), false)
  assert.equal(d.querySelector('a')?.hasAttribute('href'), false)
  assert.equal(d.querySelector('p')?.textContent, 'ok')
  assert.ok(cleaned.removed.length >= 5, String(cleaned.removed))
})

test('HTML a small model escaped (&lt;div&gt;…) becomes the page it meant; real HTML is left alone', () => {
  const b = Board.empty(parse)
  const { artboard } = b.create({ name: 'Home', html: '&lt;section class=&quot;hero&quot;&gt;&lt;h1&gt;Crumb &amp;amp; co&lt;/h1&gt;&lt;/section&gt;' })
  const d = doc(artboard.html)
  assert.equal(d.querySelector('section.hero h1')?.textContent, 'Crumb & co')
  b.write('home', '<p>Use &lt;b&gt; for bold</p>')
  assert.equal(doc(b.get('home').html).querySelector('p')?.textContent, 'Use <b> for bold')
  b.patch('home', { selector: 'p', action: 'insert_after', html: '&lt;footer id=&quot;f&quot;&gt;x&lt;/footer&gt;' })
  assert.equal(doc(b.get('home').html).querySelector('footer#f')?.textContent, 'x')
})

test('remote resources are counted so Ava can be told they will not load', () => {
  const r = standalone('<img src="https://e.com/a.png"><style>body{background:url(https://e.com/b.png)}</style>', 'X', parse)
  assert.equal(r.cleaned.remote, 2)
})

test('board.json from elsewhere is checked: no paths out of the board, known version only', () => {
  const ok = { version: 1, name: 'B', tokens: 'tokens.css', artboards: [{ file: 'a.html', name: 'A', x: 0, y: 0, width: 10, height: 10 }] }
  assert.equal(parseBoardJson(JSON.stringify(ok)).artboards[0].width, 16, 'sides are at least 16')
  assert.throws(() => parseBoardJson(JSON.stringify({ ...ok, artboards: [{ ...ok.artboards[0], file: '../secret.html' }] })), /file/)
  assert.throws(() => parseBoardJson(JSON.stringify({ ...ok, artboards: [{ ...ok.artboards[0], file: 'a/b.html' }] })), /file/)
  assert.throws(() => parseBoardJson(JSON.stringify({ ...ok, version: 2 })), /version 2/)
  assert.throws(() => parseBoardJson(JSON.stringify({ ...ok, style: 'sass' })), /style/)
  assert.equal(parseBoardJson(JSON.stringify({ ...ok, style: 'tailwind' })).style, 'tailwind')
  assert.equal(parseBoardJson(writeBoardJson(parseBoardJson(JSON.stringify(ok)))).artboards[0].file, 'a.html')
})

test('tokens: set, remove, and nothing set when one is bad', () => {
  const b = Board.empty(parse)
  b.setTokens({ '--color-accent': '#123456', '--radius': '' })
  assert.equal(b.tokens()['--color-accent'], '#123456')
  assert.equal('--radius' in b.tokens(), false)
  assert.throws(() => b.setTokens({ '--ok': '1px', '--bad': 'red; } body { display:none' }), /one CSS value/)
  assert.equal('--ok' in b.tokens(), false, 'a bad value stops the whole set')
  assert.throws(() => b.setTokens({ 'not a name': 'x' }), /token name/)
  assert.equal(parseTokens(b.tokensCss())['--color-accent'], '#123456')
})

test('every change names the files it wrote, so saving copies only those', () => {
  const b = Board.empty(parse)
  const seen: string[][] = []
  b.onChange(c => seen.push([...c.wrote, ...c.removed.map(r => `-${r}`)]))
  b.create({ name: 'A' })
  b.write('a', '<p>x</p>')
  b.place('a', { x: 10 })
  b.setTokens({ '--x': '1px' })
  b.remove('A')
  assert.deepEqual(seen, [['a.html', 'board.json', 'tokens.css'], ['a.html'], ['board.json'], ['tokens.css'], ['board.json', '-a.html']])
  assert.equal(b.files().has('a.html'), false)
})

test('saving only what each change names gives back the whole board, starter tokens included', async () => {
  const b = Board.empty(parse)
  const disk = new Map<string, string>()
  b.onChange(c => {
    const files = b.files()
    for (const p of c.wrote) disk.set(p, files.get(p)!)
    for (const p of c.removed) disk.delete(p)
  })
  b.create({ name: 'Home', html: '<h1>x</h1>' })
  b.create({ name: 'Gone' })
  b.remove('gone')
  const back = await Board.fromFiles(parse, disk)
  assert.deepEqual(back.tokens(), b.tokens())
  assert.ok(Object.keys(back.tokens()).length > 0)
  assert.deepEqual([...disk.keys()].sort(), ['board.json', 'home.html', 'tokens.css'])
  assert.equal(back.get('home').html, b.get('home').html)
})

test('an unknown artboard names the ones there are', () => {
  const b = Board.empty(parse)
  b.create({ name: 'Home' })
  assert.throws(() => b.get('pricing'), /home \(“Home”\)/)
})
