/** Default geometry and placement math for palette-inserted board objects. */
import { elementBounds, type BoardElement, type ElementStyle, type ElementType, type Point } from '../../shared/board';

/** Object kinds that are placed from the palette rather than drawn on the canvas. */
export const OBJECT_KINDS = ['rectangle', 'sticky', 'ellipse', 'diamond', 'frame', 'text'] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * Consistent creation sizes keep diagrams visually uniform without manual alignment.
 * Sizing after placement remains available through the selection resize handle.
 */
export const DEFAULT_SIZES: Record<ObjectKind, { width: number; height: number }> = {
	rectangle: { width: 200, height: 96 },
	sticky: { width: 180, height: 180 },
	ellipse: { width: 200, height: 120 },
	diamond: { width: 180, height: 120 },
	frame: { width: 480, height: 320 },
	text: { width: 200, height: 44 },
};

const DEFAULT_TEXT: Partial<Record<ObjectKind, string>> = { sticky: 'New idea', text: 'Type something' };

/** Builds a canonical element of the requested kind centered on a world point. */
export function createObjectAt(kind: ObjectKind, center: Point, style: ElementStyle): BoardElement {
	const { width, height } = DEFAULT_SIZES[kind];
	return {
		id: crypto.randomUUID(),
		type: kind as ElementType,
		x: Math.round(center.x - width / 2),
		y: Math.round(center.y - height / 2),
		width,
		height,
		rotation: 0,
		text: DEFAULT_TEXT[kind] ?? '',
		style: { ...style, fill: kind === 'sticky' ? '#FFF3AE' : style.fill },
		zIndex: Date.now(),
	};
}

const CASCADE_STEP = 28;
const CASCADE_LIMIT = 12;

/**
 * Resolves the world point at the center of the visible canvas, stepping diagonally
 * while that position is already covered so repeated placements never stack exactly.
 */
export function centerPlacement(
	viewport: { x: number; y: number; zoom: number },
	canvas: { width: number; height: number },
	elements: Iterable<BoardElement>,
): Point {
	const center = {
		x: (canvas.width / 2 - viewport.x) / viewport.zoom,
		y: (canvas.height / 2 - viewport.y) / viewport.zoom,
	};
	const occupied = [...elements].map(elementBounds);

	for (let step = 0; step < CASCADE_LIMIT; step += 1) {
		const candidate = { x: center.x + step * CASCADE_STEP, y: center.y + step * CASCADE_STEP };
		const taken = occupied.some(
			(bounds) =>
				Math.abs(bounds.x + bounds.width / 2 - candidate.x) < CASCADE_STEP / 2 &&
				Math.abs(bounds.y + bounds.height / 2 - candidate.y) < CASCADE_STEP / 2,
		);
		if (!taken) return candidate;
	}

	return center;
}
