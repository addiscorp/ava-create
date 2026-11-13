// Tailwind boards: the classes artboards use become CSS, tokens become the theme.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOMParser } from 'linkedom'
import { Board } from '../src/board.ts'
import { candidates, compileTailwind } from '../src/tailwind.ts'
import type { ParseHtml } from '../src/format.ts'

const parse: ParseHtml = html => new DOMParser().parseFromString(html, 'text/html') as unknown as Document
const tw = readFileSync(join(import.meta.dirname, '..', 'node_modules', 'tailwindcss', 'index.css'), 'utf8')

test('a Tailwind board compiles the classes its artboards use, with its tokens as the theme', async () => {
  const b = Board.empty(parse, 'B', 'tailwind')
  b.create({ name: 'Home', html: '<section class="bg-accent p-4 md:grid-cols-3"><h1 class="text-xl">Hi</h1></section>' })
  b.setTokens({ '--color-accent': '#e4572e' })
  const classes = candidates(b.list().map(a => parse(a.html)))
  assert.ok(classes.includes('bg-accent') && classes.includes('md:grid-cols-3'))
  const css = await compileTailwind(b.tokens(), classes, tw)
  assert.match(css, /\.bg-accent\s*\{\s*background-color: var\(--color-accent\)/)
  assert.match(css, /--color-accent: #e4572e/)
  assert.match(css, /\.md\\:grid-cols-3/)
  assert.doesNotMatch(css, /\.bg-red-500/, 'only the classes in use')
  b.setCompiled(css)
  assert.equal(b.files().get('tailwind.css'), css)
  const home = parse(b.get('home').html)
  assert.deepEqual([...home.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')), ['tokens.css', 'tailwind.css'])
})

test('switching a board to CSS drops tailwind.css and its links, and keeps the HTML', () => {
  const b = Board.empty(parse, 'B', 'tailwind')
  b.create({ name: 'Home', html: '<p class="text-xl">x</p>' })
  b.setCompiled('.text-xl{}')
  const seen: string[] = []
  b.onChange(c => seen.push(...c.removed))
  b.setStyle('css')
  assert.equal(b.files().has('tailwind.css'), false)
  assert.deepEqual(seen, ['tailwind.css'])
  const home = parse(b.get('home').html)
  assert.equal(home.querySelector('link[href="tailwind.css"]'), null)
  assert.equal(home.querySelector('p.text-xl')?.textContent, 'x')
  assert.equal(JSON.parse(b.files().get('board.json')!).style, 'css')
})
