<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI rules

- **Every icon-only button has a tooltip that names its action.** Use `IconButton` from `@/components/ui/icon-button` with a `label` that says what clicking does ("Close details", "Play", "Find similar sound"), not what the icon is. The label is the tooltip and, unless you pass a more specific `aria-label`, the accessible name. Don't use `<Button size="icon…">` or a native `title` for this; ESLint rejects the former.
