// The built bundle (run after `vite build`): the manifest Ava reads, local
// fonts only, Tailwind inside (no CDN), and nothing that reaches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')

test('the bundle has its manifest, its page, local fonts and its own Tailwind', () => {
  assert.ok(existsSync(join(dist, 'manifest.json')), 'run npm run build first')
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  assert.equal(manifest.id, 'create')
  assert.deepEqual(manifest.egress, [], 'Create reaches no host')
  assert.deepEqual(manifest.permissions.sort(), ['storage', 'tools'])
  const assets = readdirSync(join(dist, 'assets'))
  assert.ok(assets.some(f => f.startsWith('comfortaa-') && f.endsWith('.woff2')), 'Comfortaa is bundled')
  assert.ok(assets.some(f => f.startsWith('dm-sans-')), 'DM Sans is bundled')
  const code = assets.filter(a => /\.(css|js)$/.test(a)).map(a => readFileSync(join(dist, 'assets', a), 'utf8'))
  assert.ok(code.some(t => t.includes('@layer theme, base, components, utilities')), "Tailwind's stylesheet is in the bundle")
  for (const [i, text] of [readFileSync(join(dist, 'index.html'), 'utf8'), ...code].entries()) {
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com|unpkg\.com|jsdelivr\.net/.test(text), `file ${i} reaches a CDN`)
    assert.ok(!/url\(\s*["']?data:font/.test(text), `file ${i} inlines a font as data: (the add-on CSP refuses those)`)
  }
})

test("every tool's effect is honest: reading tools are read, the rest stay inside", () => {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  const effects = Object.fromEntries(manifest.tools.map((t: { name: string; effect: string }) => [t.name, t.effect]))
  for (const t of ['list_artboards', 'read_artboard', 'get_tokens', 'look_at_artboard']) assert.equal(effects[t], 'read', t)
  for (const t of ['new_artboard', 'write_artboard', 'patch_artboard', 'undo_artboard', 'move_artboard', 'delete_artboard', 'set_tokens', 'set_board_style']) assert.equal(effects[t], 'inside', t)
  assert.equal(Object.keys(effects).length, 12)
  for (const t of manifest.tools) assert.match(t.name, /^[a-z][a-z0-9_]{0,31}$/)
})
