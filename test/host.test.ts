// Ava's live theme and colours reach the page: applyContext with a host
// context like the one Ava sends, against a stand-in for <html> (the real
// MCP Apps functions run; only the element is fake).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-with-deps'
import { applyContext } from '../src/host.ts'

function fakeHtml() {
  const props = new Map<string, string>()
  const attrs = new Map<string, string>()
  const el = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    style: { colorScheme: '', setProperty: (k: string, v: string) => void props.set(k, v) },
  }
  ;(globalThis as { document?: unknown }).document = { documentElement: el }
  return { props, attrs, el }
}

const ctx = {
  theme: 'dark',
  styles: {
    variables: {
      '--color-background-primary': '#1e1610',
      '--color-text-primary': '#f5ede4',
      '--font-sans': undefined,
    },
  },
} as McpUiHostContext

test("Ava's colours land on the page as CSS custom properties", () => {
  const { props } = fakeHtml()
  applyContext(ctx)
  assert.equal(props.get('--color-background-primary'), '#1e1610')
  assert.equal(props.get('--color-text-primary'), '#f5ede4')
  assert.ok(!props.has('--font-sans'), 'an unset variable is left to the fallback')
  assert.ok(!props.has('variables'), 'the variables object itself is never a property')
})

test("Ava's theme sets data-theme and color-scheme", () => {
  const { attrs, el } = fakeHtml()
  applyContext(ctx)
  assert.equal(attrs.get('data-theme'), 'dark')
  assert.equal(el.style.colorScheme, 'dark')
})

test('no context, or one with no styles, changes nothing', () => {
  const { props, attrs } = fakeHtml()
  applyContext(undefined)
  applyContext({} as McpUiHostContext)
  assert.equal(props.size, 0)
  assert.equal(attrs.size, 0)
})
