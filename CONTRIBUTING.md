# Contributing

Thanks for improving Cloudflare Whiteboard. This is a reference project, so focused fixes and broadly reusable examples are the best fit.

## Development setup

1. Fork and clone the repository.
2. Create `feature/<slug>`, `fix/<slug>`, or `chore/<slug>` from `main`.
3. Run `npm install` and `npm run dev`.
4. Keep changes small and add a targeted test when practical.

No environment variables are required for local development. Wrangler simulates Durable Objects and rate limiting locally.

## Code style

- TypeScript runs in strict mode.
- Run `npm run format` for Prettier and `npm run lint` for ESLint.
- Keep client and server protocol changes synchronized in `src/shared/protocol.ts`.
- Add Durable Object migration tags; never edit a migration that may be deployed.
- Explain non-obvious tradeoffs rather than restating code in comments.

## Commits and pull requests

Use a short imperative commit subject, such as `Fix reconnect snapshot handling`. Before opening a pull request, run:

```bash
npm run check
```

Describe the user-visible behavior, testing, protocol impact, and migration requirements. Reviewers prioritize correctness, capability enforcement, storage lifecycle, abuse resistance, and accessibility.

## Bugs and features

Use the provided issue templates. A useful bug report includes a reproducible board flow, browser version, and content-free console errors. A feature request should explain the collaboration problem before proposing UI.

Never include a live capability URL, board content, or vulnerability details in a public issue. Use GitHub private security advisories for security reports.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
