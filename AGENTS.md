# Cloudflare Whiteboard

React 19 and a custom SVG editor are deployed with a Cloudflare Worker. One SQLite-backed `BoardDurableObject` coordinates each board over hibernatable WebSockets.

## Commands

| Command                  | Purpose                              |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Run Vite and the Worker locally      |
| `npm run lint`           | Check source with ESLint             |
| `npm run lint:fix`       | Fix lint and formatting issues       |
| `npm run typecheck`      | Run TypeScript without emitting      |
| `npm test`               | Run Worker-runtime tests             |
| `npm run build`          | Verify and create production output  |
| `npm run deploy:dry-run` | Build and validate the Worker bundle |
| `npm run deploy`         | Build and deploy with Wrangler       |
| `npm run cf-typegen`     | Regenerate binding types             |

## Structure

- `src/client/` contains the landing page, SVG editor, realtime hook, and Kumo styles.
- `src/server/board-do.ts` owns board authentication, SQLite state, WebSockets, and expiry.
- `src/shared/` is the versioned protocol and board model used by both runtimes.
- `src/index.ts` is the Worker entrypoint and static-assets router.
- `test/` runs inside workerd using the current Vitest 4 Cloudflare plugin.

## Rules

- Retrieve current Workers and Durable Objects documentation before platform changes.
- Use `this.ctx.acceptWebSocket()` and attachments; never replace hibernation with `accept()`.
- Persist an operation before broadcasting it.
- Never log board content or full capability tokens.
- Run `npm run cf-typegen` after changing `wrangler.jsonc` bindings.
- Do not edit `worker-configuration.d.ts` or `dist/` manually.
- Keep client and server message changes synchronized in `src/shared/protocol.ts`.
- Add new Durable Object migrations instead of editing deployed migration tags.
- Use short-lived `feature/*`, `fix/*`, or `chore/*` branches from `main`.
- Prefer small tested slices. Run `npm run check` before handing off significant work.
