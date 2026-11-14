# The Create board format, version 1

> This specification, unlike Create's code, is licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): copy it,
> implement it and build on it, with credit to Sami Fouad. Create itself is
> proprietary (see [LICENSE](LICENSE)); the format is open so a board never
> locks anyone in.

A Create board is a folder of plain files: HTML, CSS and one small JSON file.
Any browser opens its pages, any editor changes them, and any tool can read or
write a board without Create. This document is the whole format.

## The files

```
my-board/
  board.json      what the board is and where each artboard sits
  tokens.css      the shared design tokens
  tailwind.css    only in a Tailwind board: its compiled classes (derived)
  home.html       one standalone HTML document per artboard
  menu.html
  …
```

All file names are flat (no folders) and lowercase.

## board.json

```json
{
  "version": 1,
  "name": "Crumb bakery",
  "style": "css",
  "tokens": "tokens.css",
  "artboards": [
    { "file": "home.html", "name": "Home", "x": 0, "y": 0, "width": 1440, "height": 1800 },
    { "file": "menu.html", "name": "Menu", "x": 1560, "y": 0, "width": 1440, "height": 1400 }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | The format version, a whole number. This document is version 1. A reader refuses a version newer than it knows. |
| `name` | no | The board's name. Default `"Board"`. |
| `style` | no | `"css"` (default) or `"tailwind"`. See [Styles](#styles). |
| `tokens` | no | The tokens file. Default `"tokens.css"`. A flat name ending in `.css`, never `tailwind.css`. |
| `artboards` | yes | The artboards, in order (later ones draw on top where they overlap). |

Each artboard:

| Field | Required | Meaning |
|---|---|---|
| `file` | yes | Its HTML file: `[a-z0-9][a-z0-9-]*\.html`, at most 68 characters, unique on the board. No folders, so a board can never point outside itself. |
| `name` | no | What people call it. Default: the file name without `.html`. |
| `x`, `y` | yes | Its top-left corner on the board, in CSS pixels. Any number, negative too. |
| `width`, `height` | yes | Its size in CSS pixels: the viewport the page is laid out in. 16 to 10000; readers clamp. |

An artboard's **id** is its file name without `.html` (`home`). Renaming an
artboard changes `name`, never `file`.

**Unknown fields are kept.** A reader that doesn't know a field, at the top
or on an artboard, leaves it as it is when it writes the board back.

Writers emit two-space-indented JSON with a newline at the end, with the
fields in the order above.

## Artboards

Each artboard is a complete, standalone HTML document that looks right
opened on its own in a browser, with the board's files beside it:

```html
<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home</title><link rel="stylesheet" href="tokens.css"><style>
  body { margin: 0; font-family: var(--font-sans); background: var(--color-bg); color: var(--color-text); }
  .hero { padding: 96px 120px; background: var(--color-accent); color: var(--color-on-accent); }
</style></head><body>
  <section class="hero"><h1>Bread, still warm.</h1></section>
</body></html>
```

- It links the tokens file with `<link rel="stylesheet" href="tokens.css">`
  (the file `board.json` names), before its own styles so they can override
  the tokens. In a Tailwind board it also links `tailwind.css`, right after.
- It is drawn at the artboard's `width` × `height`, as a browser viewport of
  that size. Content past the bottom is cut off: make the artboard taller.
- **HTML and CSS only.** No `<script>`, `<iframe>`, `<frame>`, `<object>`,
  `<embed>`, `<base>`, `<noscript>`, `<meta http-equiv>`, no `on…`
  event-handler attributes and no `javascript:` / `data:text/html` URLs. A
  writer removes them; a renderer must not run them. A design is a picture
  of a page, and the file is as harmless opened on its own as inside Create.
- **Self-contained.** Images are inline `<svg>` or `data:` URLs. Renderers
  need not load anything from the network (Create loads nothing), so remote
  images, fonts and `@import`s may not show. Fonts are named by family with
  system fallbacks.
- Nothing Create-specific goes in the HTML: no special attributes, comments
  or classes. Create keeps no state in the file.

## tokens.css

The design tokens: CSS custom properties on `:root`, used in artboards as
`var(--name)`.

```css
:root {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --color-bg: #ffffff;
  --color-text: #1c1a17;
  --color-accent: #6646ee;
  --radius: 12px;
}
```

A reader takes every custom property declared in the file's `:root` rules.
A token value is one CSS value: it contains none of `;` `{` `}` `<` `>` or
`/*`. Create writes the file back as a single `:root` rule; anything else in
a hand-written file (other rules, comments) is not kept by Create 0.1.

No token is required. Names that read well across tools: `--color-*` for
colours, `--font-*` for font stacks, `--radius*`, `--space*`.

## Styles

`board.json`'s `style` says how artboards are styled. It is per board,
because converting Tailwind to CSS is exact and converting CSS to Tailwind
is not.

- **`css`**: each artboard styles itself with its own `<style>` (and
  `style=""` attributes), using the tokens.
- **`tailwind`**: artboards use [Tailwind CSS](https://tailwindcss.com) v4
  utility classes. The tokens are the Tailwind theme: the input to Tailwind is

  ```css
  @import "tailwindcss";
  @theme { /* every token, as in tokens.css */ }
  ```

  so `--color-accent` gives `bg-accent`, `text-accent`, `border-accent`, and
  `--font-sans` gives `font-sans`. `tailwind.css` is that input compiled for
  every class used in any artboard's `class` attributes. It is **derived**:
  a writer regenerates it whenever an artboard or the tokens change, and a
  reader that compiles Tailwind itself may ignore it. It is there so each
  artboard still opens correctly on its own. Artboards in a Tailwind board
  may still have their own `<style>`.

Switching a board's style keeps every artboard's HTML as it is and only
changes which stylesheets they link: a CSS board's styles keep working
under Tailwind (Tailwind's base styles apply too), while Tailwind classes do
nothing in a CSS board until those artboards are rewritten.

Exports to other shapes (React components, one per artboard) are made from
these files and are not part of the format.

## Storing a board elsewhere

The format is files, so wherever a board is kept it is kept as these files,
by these names. Create keeps a board in the add-on's own storage under the
keys `board/board.json`, `board/tokens.css`, `board/<id>.html` (and
`board/tailwind.css`), each holding that file's text exactly.

## Versions

This is version 1. A change that an older reader would misread raises
`version`; adding optional fields does not (readers keep unknown fields).
