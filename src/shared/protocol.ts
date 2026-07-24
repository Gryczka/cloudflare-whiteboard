/** Version-one client/server WebSocket messages and public-demo resource limits. */
import { z } from 'zod';
import { operationSchema, type BoardElement, type BoardMetadata, type BoardOperation } from './board';

export const helloMessageSchema = z.object({
	type: z.literal('hello'),
	token: z.string().min(20).max(128),
	participantId: z.string().uuid(),
	displayName: z.string().min(1).max(40),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	sinceSeq: z.number().int().nonnegative().default(0),
});
export const clientOperationSchema = z.object({
	type: z.literal('operation'),
	opId: z.string().uuid(),
	operation: operationSchema,
});
export const presenceMessageSchema = z.object({
	type: z.literal('presence'),
	x: z.number().finite().min(-100_000).max(100_000),
	y: z.number().finite().min(-100_000).max(100_000),
	selectedIds: z.array(z.string().uuid()).max(100),
	tool: z.string().max(30),
});
export const clientMessageSchema = z.discriminatedUnion('type', [
	helloMessageSchema,
	clientOperationSchema,
	presenceMessageSchema,
	z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export interface Presence {
	participantId: string;
	displayName: string;
	color: string;
	x: number;
	y: number;
	selectedIds: string[];
	tool: string;
}
export type ServerMessage =
	| {
			type: 'welcome';
			permission: 'edit' | 'view';
			sessionId: string;
			serverSeq: number;
			metadata: BoardMetadata;
			elements?: BoardElement[];
			operations?: Array<{ serverSeq: number; operation: BoardOperation }>;
			participants: Presence[];
	  }
	| { type: 'operation-applied'; opId: string; serverSeq: number; operation: BoardOperation }
	| { type: 'operation-rejected'; opId?: string; reason: string }
	| ({ type: 'presence' } & Presence)
	| { type: 'participant-left'; participantId: string }
	| { type: 'pong' }
	| { type: 'board-expired' }
	| { type: 'error'; reason: string };

export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_ELEMENTS = 2_000;
export const MAX_CONNECTIONS = 30;
export const OPLOG_LIMIT = 2_000;
