/** Palette definitions shared by the toolbar component and keyboard shortcuts. */
import { Eraser, Hand, Highlighter, Minus, MousePointer2, MoveUpRight, Pencil } from 'lucide-react';
import type { ObjectKind } from './shape-defaults';

/** Tools that change how the pointer behaves on the canvas. */
export type ModeTool = 'select' | 'hand' | 'pencil' | 'highlighter' | 'line' | 'arrow' | 'eraser';

export const MODE_TOOLS: Array<{ id: ModeTool; label: string; icon: typeof MousePointer2; key: string }> = [
	{ id: 'select', label: 'Select', icon: MousePointer2, key: 'V' },
	{ id: 'hand', label: 'Pan', icon: Hand, key: 'H' },
	{ id: 'pencil', label: 'Draw', icon: Pencil, key: 'P' },
	{ id: 'highlighter', label: 'Highlighter', icon: Highlighter, key: 'G' },
	{ id: 'line', label: 'Line', icon: Minus, key: 'L' },
	{ id: 'arrow', label: 'Arrow', icon: MoveUpRight, key: 'A' },
	{ id: 'eraser', label: 'Eraser', icon: Eraser, key: 'E' },
];

export const OBJECT_TILES: Array<{ id: ObjectKind; label: string; key: string }> = [
	{ id: 'rectangle', label: 'Text box', key: 'R' },
	{ id: 'sticky', label: 'Sticky', key: 'S' },
	{ id: 'ellipse', label: 'Ellipse', key: 'O' },
	{ id: 'diamond', label: 'Diamond', key: 'D' },
	{ id: 'frame', label: 'Frame', key: 'F' },
	{ id: 'text', label: 'Text', key: 'T' },
];
