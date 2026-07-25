# Threat Model

## Protected assets

- Board content and chat history
- Edit and view capabilities
- Durable Object storage and compute budget
- Availability for legitimate collaborators

## Trust boundaries

Browsers are untrusted. All geometry, text, permissions, message sizes, and rates are validated inside the Durable Object. The Worker is trusted to create random board IDs and route requests, but only the Durable Object decides whether a capability can mutate state.

## Primary threats

| Threat                  | Mitigation                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Board enumeration       | Random 128-bit board IDs plus independent 192-bit capabilities                                                                     |
| Token leakage           | URL fragments, no-referrer policy, no token logging, TLS WebSockets                                                                |
| Viewer mutation         | Server-side capability check on every operation                                                                                    |
| Replay                  | Idempotent operation UUIDs                                                                                                         |
| Stored XSS              | Structured element schema, React text nodes, no raw HTML or foreign SVG, CSP                                                       |
| Chat abuse              | Edit-only posting, 500-character bodies, per-connection message rate limit, 200-message retention, server-assigned author identity |
| Resource exhaustion     | Creation, connection, message, operation, element, and point limits; five-second authentication deadline                           |
| Broadcast amplification | Per-connection message rate limit and bounded room size                                                                            |
| Infinite retention      | Edit-only 30-day sliding TTL and alarm-driven deletion                                                                             |
| Sensitive data in logs  | Event metadata only; no operations, text, or full identifiers                                                                      |

## Accepted risks

Capability links are bearer credentials and cannot be revoked in version one. Anyone who receives a valid link retains its permission until the board expires. Public deployments should clearly warn users not to store confidential information.

The project does not host uploaded images or arbitrary SVG. Deployments that add uploads need a separate moderation, content-scanning, metadata-removal, and takedown design.

## Reporting

Use GitHub's private security advisory flow for vulnerabilities. Use a regular issue only for non-sensitive abuse-handling questions.
