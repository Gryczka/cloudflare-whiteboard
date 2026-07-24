/** React integration for authentication, reconnect, delta replay, and presence. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOperation, type BoardElement, type BoardMetadata, type BoardOperation } from '../../shared/board';
import type { Presence, ServerMessage } from '../../shared/protocol';

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'invalid';

const NAMES = ['Amber Otter', 'Brisk Falcon', 'Clever Fox', 'Daring Heron', 'Electric Moth', 'Gentle Badger', 'Merry Orca', 'Swift Gecko'];
const COLORS = ['#0A95FF', '#EE0DDB', '#00A96E', '#9616FF', '#FF5B66', '#D97706'];

function identity() {
	const stored = localStorage.getItem('whiteboard-identity');
	if (stored) return JSON.parse(stored) as { id: string; name: string; color: string };
	const bytes = crypto.getRandomValues(new Uint8Array(2));
	const value = {
		id: crypto.randomUUID(),
		name: NAMES[bytes[0] % NAMES.length],
		color: COLORS[bytes[1] % COLORS.length],
	};
	localStorage.setItem('whiteboard-identity', JSON.stringify(value));
	return value;
}

/** Maintains one board's canonical client state over a reconnecting WebSocket. */
export function useBoard(boardId: string, token: string) {
	const [elements, setElements] = useState<Map<string, BoardElement>>(new Map());
	const [metadata, setMetadata] = useState<BoardMetadata | null>(null);
	const [permission, setPermission] = useState<'edit' | 'view'>('view');
	const [status, setStatus] = useState<ConnectionStatus>('connecting');
	const [participants, setParticipants] = useState<Map<string, Presence>>(new Map());
	const socketRef = useRef<WebSocket | null>(null);
	const sequenceRef = useRef(0);
	const reconnectRef = useRef(0);
	const retryRef = useRef<number | undefined>(undefined);
	const [userIdentity] = useState(identity);

	useEffect(() => {
		let cancelled = false;

		function connect() {
			if (cancelled) return;
			setStatus(reconnectRef.current ? 'reconnecting' : 'connecting');
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const socket = new WebSocket(`${protocol}//${window.location.host}/api/boards/${boardId}/ws`);
			socketRef.current = socket;

			socket.addEventListener('open', () => {
				const user = userIdentity;
				socket.send(
					JSON.stringify({
						type: 'hello',
						token,
						participantId: user.id,
						displayName: user.name,
						color: user.color,
						sinceSeq: sequenceRef.current,
					}),
				);
			});
			socket.addEventListener('message', (event) => {
				const message = JSON.parse(String(event.data)) as ServerMessage;
				if (message.type === 'welcome') {
					setPermission(message.permission);
					setMetadata(message.metadata);
					sequenceRef.current = message.serverSeq;
					if (message.elements) setElements(new Map(message.elements.map((element) => [element.id, element])));
					if (message.operations) {
						setElements((current) => message.operations!.reduce((state, item) => applyOperation(state, item.operation), current));
					}
					setParticipants(new Map(message.participants.map((person) => [person.participantId, person])));
					reconnectRef.current = 0;
					setStatus('connected');
				} else if (message.type === 'operation-applied') {
					sequenceRef.current = Math.max(sequenceRef.current, message.serverSeq);
					setElements((current) => applyOperation(current, message.operation));
					if (message.operation.action === 'title') {
						const title = message.operation.title;
						setMetadata((current) => (current ? { ...current, title, updatedAt: Date.now() } : current));
					} else {
						setMetadata((current) => (current ? { ...current, updatedAt: Date.now(), expiresAt: Date.now() + 30 * 86_400_000 } : current));
					}
				} else if (message.type === 'operation-rejected') {
					// Reconnect to discard optimistic state and load the canonical board.
					socket.close(1012, 'Resync after rejected operation');
				} else if (message.type === 'presence') {
					setParticipants((current) => new Map(current).set(message.participantId, message));
				} else if (message.type === 'participant-left') {
					setParticipants((current) => {
						const next = new Map(current);
						next.delete(message.participantId);
						return next;
					});
				} else if (message.type === 'board-expired') {
					setStatus('invalid');
				}
			});
			socket.addEventListener('close', (event) => {
				if (cancelled) return;
				if (event.code === 1008 || event.code === 1000) {
					setStatus('invalid');
					return;
				}
				setStatus('offline');
				reconnectRef.current += 1;
				const delay = Math.min(10_000, 500 * 2 ** reconnectRef.current);
				retryRef.current = window.setTimeout(connect, delay);
			});
			socket.addEventListener('error', () => socket.close());
		}

		connect();
		return () => {
			cancelled = true;
			if (retryRef.current) window.clearTimeout(retryRef.current);
			socketRef.current?.close();
		};
	}, [boardId, token, userIdentity]);

	const commit = useCallback(
		(operation: BoardOperation, opId = crypto.randomUUID()) => {
			if (permission !== 'edit' || socketRef.current?.readyState !== WebSocket.OPEN) return false;
			setElements((current) => applyOperation(current, operation));
			socketRef.current.send(JSON.stringify({ type: 'operation', opId, operation }));
			return true;
		},
		[permission],
	);

	const sendPresence = useCallback((presence: Omit<Presence, 'participantId' | 'displayName' | 'color'>) => {
		if (socketRef.current?.readyState !== WebSocket.OPEN) return;
		socketRef.current.send(JSON.stringify({ type: 'presence', ...presence }));
	}, []);

	return {
		elements,
		metadata,
		permission,
		status,
		participants,
		identity: userIdentity,
		commit,
		sendPresence,
	};
}
