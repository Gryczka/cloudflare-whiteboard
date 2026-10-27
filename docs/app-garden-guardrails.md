# Whiteboard guardrails and discovery

Broadcasts now require an OPEN authenticated socket. Presence mutates the current rate-limit attachment rather than overwriting freshly incremented counters. Initialization, writes, auth and close/error scheduling all use the nearest pending-auth or board-expiry deadline. Late authentication is rejected even when an alarm delivery is delayed. Existing capability roles, streaming body/frame/model/chat/operation/connection limits remain.

Upgrade capabilities are checked before socket acceptance. A fixed `BOARD_DIRECTORY` singleton admits at most 20 new boards/hour and 50 retained boards, with edit/view digests and absolute deadlines. Arbitrary IDs and wrong new-board capabilities never dispatch to a per-board actor. The existing 5/minute per-location creation limiter remains an initial filter. Additive `v2-directory` creates SQLite `BoardDirectory`; preserve `v1`/BOARDS. No new secret is needed.

Pending hello: 5 seconds, after a valid capability has already been checked. `BOARD_TTL_DAYS` defaults to an absolute 30-day lifetime, bounded to 90 days; edits do not renew it. Fetch, hello after asynchronous hashing, chat and operations reject an expired actor even when its alarm is delayed. At expiry, deleteAll removes storage and alarms under compatibility 2026-07-23.

All materialized element rows are bounded: deleted/cleared payloads are removed, with delete/clear operations retained in a contiguous replay suffix. Limits are 2,000 elements/8 MiB and 2,000 replay operations/4 MiB. Byte-overflow writes roll back the element, sequence and operation together. Out-of-window clients receive a canonical snapshot. These are admitted-state/work limits, not a dollar or raw-traffic ceiling.

`LEGACY_BOARD_OBJECT_IDS` is a hash inventory of hasStoredData actors from an existing BOARDS namespace, collected from the objects API without actor-content or capability reads. The tracked `wrangler.jsonc` keeps it `[]`, which is correct for a fresh deployment; the hosted garden keeps its verified inventory in an untracked production config selected with `GARDEN_PRODUCTION_PREFLIGHT=1`. Only an inventory match permits legacy dispatch, followed by validation of the existing edit/view digest before schema writes or socket acceptance. The current stored legacy expiry is preserved as its fixed final deadline. Staging uses `[]`. Legacy capability links continue to work after refreshing the client; never copy a production inventory into another namespace.

The SPA has a useful non-JavaScript HTML introduction, canonical homepage, real XML sitemap and robots Content Signals (`search=yes,ai-input=yes,ai-train=no`). Board/API paths remain excluded; board document responses additionally carry noindex/nofollow. Documentation/dashboard resource anchors carry garden referral parameters, including preserving the dashboard's existing `to` parameter. Robots is crawler guidance, not access control.

```sh
npm run cf-typegen
npm run lint
npm run typecheck
npm test
npm run deploy:dry-run
npm run deploy
```

The deployment uses the Vite-generated Wrangler config. Runtime regressions cover pre-dispatch admission, pre-accept capability validation, legacy hash-only routing, UUID create/delete/clear churn, rollback on retained-byte overflow, absolute expiry including async crypto races, fanout and presence/auth counters. Hosted checks use separate staging bindings and test-created state only.
