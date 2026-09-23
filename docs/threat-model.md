# Threat Model

## Protected assets

- Board content and chat history
- Edit and view capabilities
- Durable Object storage and compute budget
- Availability for legitimate collaborators

## Trust boundaries

Browsers are untrusted. All geometry, text, permissions, message sizes, and rates are validated inside the Durable Object. The Worker is trusted to create random board IDs and route requests, but only the Durable Object decides whether a capability can mutate state.

Board creation assumes Cloudflare-proxied ingress. The Worker trusts only the platform-provided `CF-Connecting-IP`, ignores spoofable forwarding headers, and fails closed with HTTP 500 if the platform header is missing. Deployments that bypass Cloudflare's proxy must supply an equivalent trusted client-identity boundary or replace this limiter design.

## Primary threats

| Threat                  | Mitigation                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Board enumeration       | Random 128-bit board IDs plus independent 192-bit capabilities                                                                     |
| Token leakage           | URL fragments, no-referrer policy, no token logging, TLS WebSockets                                                                |
| Viewer mutation         | Server-side capability check on every operation                                                                                    |
| Replay                  | Idempotent operation UUIDs                                                                                                         |
| Stored XSS              | Structured element schema, React text nodes, no raw HTML or foreign SVG, CSP                                                       |
| Chat abuse              | Edit-only posting, 500-character bodies, per-connection message rate limit, 200-message retention, server-assigned author identity |
| Resource exhaustion     | Per-address creation limiter with ten-minute storage cleanup; connection, message, operation, element, and point limits            |
| Broadcast amplification | Per-connection message rate limit and bounded room size                                                                            |
| Infinite retention      | Edit-only 30-day sliding TTL and alarm-driven deletion                                                                             |
| Sensitive data in logs  | Event metadata only; no operations, text, or full identifiers                                                                      |

## Accepted risks

Capability links are bearer credentials and cannot be revoked in version one. Anyone who receives a valid link retains its permission until the board expires. Public deployments should clearly warn users not to store confidential information.

The project does not host uploaded images or arbitrary SVG. Deployments that add uploads need a separate moderation, content-scanning, metadata-removal, and takedown design.

The limiter uses an unsalted SHA-256 digest of `CF-Connecting-IP` as a deterministic Durable Object name. This avoids persisting or logging the raw address in application code, but it is pseudonymization rather than anonymization. The IPv4 input space is enumerable, so an observer with access to digests can recover addresses by dictionary search. Treat limiter identifiers as personal or sensitive metadata according to the deployment's privacy requirements.

All users behind the same public IP, including shared NAT and enterprise egress gateways, share one five-per-minute allowance. One busy user can therefore temporarily deny board creation to others on that address. Conversely, clients able to rotate public addresses receive independent allowances.

The ten-minute inactivity alarm bounds persistent limiter storage under normal operation. High-cardinality traffic can still create many short-lived Durable Objects and consume compute before cleanup.

## Temporary-account scope

This compatibility branch replaces only the unsupported native Rate Limiting binding; the full/default `main` branch remains unchanged. Temporary Wrangler deployment is intended for unauthenticated previews, not production or CI/CD. Existing OAuth, API token, or global API key credentials make `--temporary` fail. The account must be fully claimed within 60 minutes or Cloudflare deletes it and all resources. See [Claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/) for current requirements.

## Reporting

Use GitHub's private security advisory flow for vulnerabilities. Use a regular issue only for non-sensitive abuse-handling questions.
