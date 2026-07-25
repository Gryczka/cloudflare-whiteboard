# Realtime Protocol

The protocol is JSON over one hibernatable WebSocket. The current wire version is implicit version `1`; breaking changes should add an explicit envelope version before deployment.

## Connection

The browser connects to `/api/boards/:boardId/ws`. Its first message must be `hello` with the capability token, anonymous participant identity, and last known server sequence. Unauthenticated sockets cannot receive board content.

The Durable Object responds with `welcome` containing metadata, participants, and either a complete element snapshot or retained operations after `sinceSeq`.

## Durable messages

`operation` carries an idempotent UUID and one mutation:

- `put`: create or replace one canonical element
- `delete`: tombstone one element
- `clear`: tombstone all active elements
- `title`: change board metadata

The Durable Object sends `operation-applied` only after SQLite persistence succeeds. It includes the canonical operation and monotonically increasing `serverSeq`.

## Chat

`chat` carries a trimmed body of 1–500 characters. The Durable Object stamps identity from the authenticated connection attachment rather than trusting the client, writes the message to SQLite, prunes history beyond 200 messages, and then broadcasts `chat` to every connection including the sender.

Because the sender waits for that echo instead of rendering optimistically, all participants observe one server-defined order and a reconnect cannot duplicate a message. `welcome` carries the retained history, so a reloading browser recovers the conversation.

Only edit capabilities may post. A view-only connection receives an `error` and nothing is stored. Chat does not advance the board sequence and does not extend expiry, which stays edit-based.

## Transient messages

`presence` includes cursor coordinates, selection IDs, and current tool. It is stored only in the WebSocket attachment and relayed to peers. Presence never changes board expiry and is not replayed after disconnect.

## Reconnect

The browser keeps its highest accepted sequence. On reconnect, the Durable Object sends operations after that sequence if they remain in the bounded tail. Otherwise, it sends the current materialized snapshot.

Duplicate `opId` values return the originally persisted operation. This prevents a network retry from applying a mutation twice.
