# Create

An infinite design canvas, as an [Ava](https://github.com/addiscorp/ava)
add-on. Ava builds designs as HTML/CSS artboards through tools while the
person watches them change. There is no simulated cursor: the model works
through MCP tools, and the canvas redraws as each call lands.

- **The canvas:** pan (drag the background, scroll, or hold Space), zoom
  (pinch, ⌘/Ctrl+scroll, `+` `-` `0`, Shift+1 to fit), select an artboard
  and move it by its label.
- **The artboards:** each one is a standalone HTML document drawn in a
  sandboxed frame with no scripts and its own CSP (styles and `data:` images
  only), so model-written HTML can draw and do nothing else.
- **The board is plain files**, in an open, versioned format:
  [FORMAT.md](FORMAT.md). One `.html` per artboard, `tokens.css`,
  `board.json`. Create stores exactly those files in its own storage.
- **CSS or Tailwind**, per board. A Tailwind board's classes are compiled
  here, with Tailwind in the bundle (no CDN, no network); its tokens are the
  Tailwind theme.

It reaches no host on the internet (`egress` is empty) and asks Ava only for
`storage` and `tools`.

## Ava's tools

Ava sees them as `create_<name>`.

| Tool | Effect | What it does |
|---|---|---|
| `list_artboards` | read | The artboards (id, name, position, size), the board's style and token names. |
| `new_artboard` | inside | Add an artboard: name, size, position, and its page in `html`. |
| `read_artboard` | read | One artboard's HTML. |
| `write_artboard` | inside | Replace an artboard's HTML. |
| `patch_artboard` | inside | Change the elements matching a CSS selector: `set_text`, `set_html`, `replace`, `append`, `prepend`, `insert_before`, `insert_after`, `remove`, `set_style`, `set_attribute`, `remove_attribute`, `add_class`, `remove_class`. The answer says how many elements matched and lists each change, before → after. `set_text`, `set_html`, `replace` and `remove` change one element: when the selector matches several, nothing changes and the error gives a selector for each match (`all: true` means every one). No match is an error that lists selectors that exist. |
| `undo_artboard` | inside | Put an artboard's HTML back as it was before its last `write_artboard` or `patch_artboard`; again for the one before (20 deep, while Create is open). |
| `move_artboard` | inside | Rename, move or resize. |
| `delete_artboard` | inside | Delete one. |
| `get_tokens` / `set_tokens` | read / inside | The shared design tokens (CSS variables every artboard uses). |
| `look_at_artboard` | read | A PNG of the artboard as drawn (MCP image content) plus its layout as data: main blocks with positions and text, and problems (content cut off, images that don't load). |
| `set_board_style` | inside | Switch the board between `css` and `tailwind`. |

Every change is stored before the tool answers, so a board survives Ava
restarting straight after.

## Build and test

Node 24 or newer.

```sh
npm ci --ignore-scripts
npm run check      # tsc
npm run build      # tsc, then vite build into dist/
npm test           # node --test: the format, the board, patches, Tailwind, and the built bundle (run after build)
```

`dist/` is the add-on: `manifest.json`, `index.html`, `icon.svg` and
`assets/` (the scripts, one stylesheet, and the fonts as files from
`@fontsource`; the add-on's CSP only allows its own origin). CI runs those
four commands on every PR and on main.

To try it in Ava before it's in the catalogue, a debug build of Ava loads
the built bundle of every folder in its repo's `addons/` (see addiscorp/ava
`src-tauri/src/addons/mod.rs` and `qa/README.md`): link this checkout there
as `addons/create`.

## Versions, the listing and the catalogue

As in [ava-notebook](https://github.com/addiscorp/ava-notebook): the version
lives in `public/manifest.json` only; `listing/` is what the catalogue shows;
[addiscorp/ava-catalogue](https://github.com/addiscorp/ava-catalogue) pins a
commit of this repo, builds it, signs it and publishes it. Nothing is
published from here.

## Clean room

Create is designed from first principles. Nobody working on it reads the
source, repositories or implementation docs of other design canvases, in
particular Doop (AGPL-3.0) or Paper. Its dependencies are MIT, ISC, BSD or
Apache licensed, plus the OFL fonts from @fontsource.

## License

Proprietary, all rights reserved: see [LICENSE](LICENSE). First-party Ava
add-ons are proprietary, like Ava, and formats stay open (Ava APS 1,
avacanada/aps#1, under Addis APS 17).
Versions released before that change stay MIT for anyone who has them.

The board format in [FORMAT.md](FORMAT.md) is open: that document is licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), so anyone can read
and write boards without Create.
