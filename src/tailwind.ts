// Tailwind boards: compile the classes the artboards use into tailwind.css,
// here, with the board's tokens as the Tailwind theme. Tailwind (MIT) is in
// the bundle; nothing is fetched.
import { compile } from 'tailwindcss'
import type { Tokens } from './format.ts'

/** Every class name in a document's class attributes. */
export function candidates(docs: Iterable<Document>): string[] {
  const out = new Set<string>()
  for (const doc of docs) for (const el of [...doc.querySelectorAll('[class]')]) for (const c of el.classList) out.add(c)
  return [...out].sort()
}

/** The Tailwind input: everything Tailwind has, then the tokens as its theme. */
export function input(tokens: Tokens): string {
  const theme = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `@import "tailwindcss";\n@theme {\n${theme}\n}\n`
}

/**
 * tailwind.css for these tokens and classes. `tailwindCss` is the text of
 * tailwindcss/index.css (passed in so tests read it from disk and the page
 * from its bundle).
 */
export async function compileTailwind(tokens: Tokens, classes: string[], tailwindCss: string): Promise<string> {
  const compiler = await compile(input(tokens), {
    base: '/',
    loadStylesheet: async (id: string, base: string) => {
      if (id !== 'tailwindcss') throw new Error(`Create's Tailwind has no stylesheet “${id}”.`)
      return { path: 'tailwindcss/index.css', base, content: tailwindCss }
    },
  } as never)
  return compiler.build(classes)
}
