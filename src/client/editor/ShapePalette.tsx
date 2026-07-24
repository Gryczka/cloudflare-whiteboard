/** Top strip holding canvas modes and draggable object tiles. */
import { MODE_TOOLS, OBJECT_TILES, type ModeTool } from './palette-items';
import type { ObjectKind } from './shape-defaults';

/** Miniature preview so each tile reads as the object it inserts. */
function TilePreview({ kind }: { kind: ObjectKind }) {
	const shared = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;
	return (
		<svg viewBox="0 0 40 26" aria-hidden="true" focusable="false">
			{kind === 'rectangle' && (
				<>
					<rect x="4" y="4" width="32" height="18" rx="3" {...shared} />
					<path d="M10 12h20M10 17h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
				</>
			)}
			{kind === 'sticky' && (
				<>
					<rect x="8" y="3" width="24" height="20" rx="2" fill="#FFF3AE" stroke="currentColor" strokeWidth="1.6" />
					<path d="M13 10h14M13 15h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
				</>
			)}
			{kind === 'ellipse' && <ellipse cx="20" cy="13" rx="16" ry="9" {...shared} />}
			{kind === 'diamond' && <path d="M20 3 L36 13 L20 23 L4 13 Z" {...shared} />}
			{kind === 'frame' && (
				<>
					<rect x="4" y="6" width="32" height="17" rx="1.5" {...shared} />
					<path d="M4 10h32" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
				</>
			)}
			{kind === 'text' && (
				<>
					<path d="M11 7h18M20 7v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					<path d="M16 20h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
				</>
			)}
		</svg>
	);
}

interface ShapePaletteProps {
	tool: ModeTool;
	onSelectTool: (tool: ModeTool) => void;
	onPlaceObject: (kind: ObjectKind) => void;
	onBeginInsert: (event: React.PointerEvent<HTMLButtonElement>, kind: ObjectKind) => void;
	onInsertMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
	onInsertEnd: (event: React.PointerEvent<HTMLButtonElement>, committed: boolean) => void;
}

export function ShapePalette({ tool, onSelectTool, onPlaceObject, onBeginInsert, onInsertMove, onInsertEnd }: ShapePaletteProps) {
	return (
		<div className="board-palette" role="toolbar" aria-label="Board tools and shapes">
			<div className="palette-modes" role="group" aria-label="Canvas tools">
				{MODE_TOOLS.map(({ id, label, icon: Icon, key }) => (
					<button
						key={id}
						type="button"
						className={`palette-mode ${tool === id ? 'active' : ''}`}
						aria-pressed={tool === id}
						aria-label={`${label} (${key})`}
						title={`${label} (${key})`}
						onClick={() => onSelectTool(id)}
					>
						<Icon />
					</button>
				))}
			</div>
			<span className="palette-divider" aria-hidden="true" />
			<div className="palette-objects" role="group" aria-label="Insert a shape">
				{OBJECT_TILES.map(({ id, label, key }) => (
					<button
						key={id}
						type="button"
						className="palette-tile"
						aria-label={`Add ${label} (${key}). Click to place, or drag onto the board.`}
						title={`Add ${label} (${key}) — click to place, or drag onto the board`}
						onPointerDown={(event) => onBeginInsert(event, id)}
						onPointerMove={onInsertMove}
						onPointerUp={(event) => onInsertEnd(event, true)}
						onPointerCancel={(event) => onInsertEnd(event, false)}
						// Pointer input is handled above; detail 0 means the button was activated by keyboard.
						onClick={(event) => {
							if (event.detail === 0) onPlaceObject(id);
						}}
					>
						<TilePreview kind={id} />
						<span>{label}</span>
					</button>
				))}
			</div>
		</div>
	);
}
