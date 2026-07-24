/** Shared vector element model, validation schemas, and pure state reducer. */
import { z } from 'zod';

export const ELEMENT_TYPES = [
	'rectangle',
	'ellipse',
	'diamond',
	'line',
	'arrow',
	'freehand',
	'highlighter',
	'text',
	'sticky',
	'frame',
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];
export const ARROW_HEADS = ['none', 'arrow', 'dot', 'diamond'] as const;
export type ArrowHead = (typeof ARROW_HEADS)[number];
export interface Point {
	x: number;
	y: number;
}
export interface ElementStyle {
	stroke: string;
	fill: string;
	strokeWidth: number;
	opacity: number;
	dash: 'solid' | 'dashed' | 'dotted';
	fontSize: number;
	textAlign: 'left' | 'center' | 'right';
	startArrow?: ArrowHead;
	endArrow?: ArrowHead;
}
export interface BoardElement {
	id: string;
	type: ElementType;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	points?: Point[];
	text?: string;
	style: ElementStyle;
	zIndex: number;
	locked?: boolean;
	groupId?: string;
	sourceId?: string;
	targetId?: string;
}
export interface BoardMetadata {
	title: string;
	createdAt: number;
	updatedAt: number;
	expiresAt: number;
}

const pointSchema = z.object({
	x: z.number().finite().min(-100_000).max(100_000),
	y: z.number().finite().min(-100_000).max(100_000),
});
const styleSchema = z.object({
	stroke: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	fill: z.string().regex(/^(transparent|#[0-9a-fA-F]{6})$/),
	strokeWidth: z.number().min(1).max(24),
	opacity: z.number().min(0.1).max(1),
	dash: z.enum(['solid', 'dashed', 'dotted']),
	fontSize: z.number().min(10).max(120),
	textAlign: z.enum(['left', 'center', 'right']),
	startArrow: z.enum(ARROW_HEADS).optional(),
	endArrow: z.enum(ARROW_HEADS).optional(),
});
export const boardElementSchema: z.ZodType<BoardElement> = z.object({
	id: z.string().uuid(),
	type: z.enum(ELEMENT_TYPES),
	x: z.number().finite().min(-100_000).max(100_000),
	y: z.number().finite().min(-100_000).max(100_000),
	width: z.number().finite().min(0).max(100_000),
	height: z.number().finite().min(0).max(100_000),
	rotation: z.number().finite().min(-360).max(360),
	points: z.array(pointSchema).max(5_000).optional(),
	text: z.string().max(4_000).optional(),
	style: styleSchema,
	zIndex: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
	locked: z.boolean().optional(),
	groupId: z.string().uuid().optional(),
	sourceId: z.string().uuid().optional(),
	targetId: z.string().uuid().optional(),
});
export const operationSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('put'), element: boardElementSchema }),
	z.object({ action: z.literal('delete'), elementId: z.string().uuid() }),
	z.object({ action: z.literal('clear') }),
	z.object({ action: z.literal('title'), title: z.string().trim().min(1).max(120) }),
]);
export type BoardOperation = z.infer<typeof operationSchema>;

export const DEFAULT_STYLE: ElementStyle = {
	stroke: '#262626',
	fill: 'transparent',
	strokeWidth: 2,
	opacity: 1,
	dash: 'solid',
	fontSize: 24,
	textAlign: 'left',
	startArrow: 'none',
	endArrow: 'none',
};

/** Applies one canonical operation without mutating the previous element map. */
export function applyOperation(elements: ReadonlyMap<string, BoardElement>, operation: BoardOperation): Map<string, BoardElement> {
	const next = new Map(elements);
	if (operation.action === 'put') next.set(operation.element.id, operation.element);
	if (operation.action === 'delete') next.delete(operation.elementId);
	if (operation.action === 'clear') next.clear();
	return next;
}

/** Returns axis-aligned world bounds for an element, including point-based strokes. */
export function elementBounds(element: BoardElement) {
	if (element.points?.length) {
		const xs = element.points.map((point) => element.x + point.x);
		const ys = element.points.map((point) => element.y + point.y);
		return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
	}
	return { x: element.x, y: element.y, width: element.width, height: element.height };
}
