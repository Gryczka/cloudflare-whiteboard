# Realtime Protocol

The protocol is JSON over one hibernatable WebSocket. The current wire version is implicit version `1`; breaking changes should add an explicit envelope version before deployment.

## Connection

The browser connects to `/api/boards/:boardId/ws` with exactly two WebSocket protocols: `whiteboard` and `cap.<capability>`. The Worker checks a fixed bounded directory before per-board dispatch; only inventory-verified legacy actors bypass that directory, and the actor still validates their existing capability before accepting a socket. The server selects `whiteboard`. Capabilities never appear in request URLs.

The first frame remains `hello` with the same capability token, anonymous participant identity, and last known server sequence. It must arrive within five seconds and match the capability presented at upgrade. Pending hello sockets cannot receive board content. Existing capability links remain valid with the refreshed client; already-loaded old clients need a page refresh for the new upgrade protocol.

The Durable Object responds with `welcome` containing metadata, participants, and either a complete element snapshot or retained operations after `sinceSeq`.

## Durable messages

`operation` carries an idempotent UUID and one mutation:

- `put`: create or replace one canonical element
- `delete`: remove one materialized element; retain the delete operation in replay
- `clear`: remove all materialized elements; retain the clear operation in replay
- `title`: change board metadata

The Durable Object sends `operation-applied` only after SQLite persistence succeeds. It includes the canonical operation and monotonically increasing `serverSeq`.

## Chat

`chat` carries a trimmed body of 1–500 characters. The Durable Object stamps identity from the authenticated connection attachment rather than trusting the client, writes the message to SQLite, prunes history beyond 200 messages, and then broadcasts `chat` to every connection including the sender.

Because the sender waits for that echo instead of rendering optimistically, all participants observe one server-defined order and a reconnect cannot duplicate a message. `welcome` carries the retained history, so a reloading browser recovers the conversation.

Only edit capabilities may post. A view-only connection receives an `error` and nothing is stored. Chat does not advance the board sequence or extend the board's absolute expiry. No mutation extends that expiry.

## Transient messages

`presence` includes cursor coordinates, selection IDs, and current tool. It is stored only in the WebSocket attachment and relayed to peers. Presence never changes board expiry and is not replayed after disconnect.

## Reconnect

The browser keeps its highest accepted sequence. On reconnect, the Durable Object sends operations after that sequence if they remain in the bounded tail. Otherwise, it sends the current materialized snapshot.

Materialized elements retain at most 2,000 rows and 8 MiB of UTF-8 payload. Deleted payloads are removed immediately; legacy tombstones are pruned after successful capability validation. Replay retains a contiguous suffix of at most 2,000 operations and 4 MiB. An over-byte-limit element put rolls back its element, sequence and operation together.

Duplicate `opId` values return the originally persisted operation. This prevents a network retry from applying a mutation twice.
