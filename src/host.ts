// Ava's theme and colours onto this page. They arrive in MCP Apps' host
// context, in the handshake and whenever they change, as the standard style
// variables (style.css falls back to its own).
//
// It's `styles.variables` that holds them, not `styles`: handing over
// `styles` set one property named "variables" and none of Ava's colours, so
// only the fallbacks ever showed. Typed as McpUiHostContext, that mistake no
// longer compiles.
import { applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-with-deps'

/** Apply `ctx`'s theme and style variables to `root` (the page's <html> when left out). */
export function applyContext(ctx: McpUiHostContext | undefined, root?: HTMLElement): void {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables, root)
}
