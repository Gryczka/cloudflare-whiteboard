/** Collaborative SVG editor, tool interactions, keyboard controls, and portability. */
import {
	AlignCenterHorizontal,
	AlignCenterVertical,
	ArrowDown,
	ArrowUp,
	Circle,
	Copy,
	Diamond,
	Download,
	Eraser,
	Frame,
	Group,
	Hand,
	Highlighter,
	Lock,
	Menu,
	Minus,
	MousePointer2,
	Pencil,
	Redo2,
	RectangleHorizontal,
	Share2,
	StickyNote,
	Trash2,
	Type,
	Undo2,
	Ungroup,
	Unlock,
	Upload,
	UsersRound,
	ZoomIn,
	ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	boardElementSchema,
	DEFAULT_STYLE,
	elementBounds,
	type BoardElement,
	type BoardOperation,
	type ElementStyle,
	type ElementType,
	type Point,
} from '../../shared/board';
import type { Presence } from '../../shared/protocol';
import { Logo } from '../components/Logo';
import { useBoard } from '../realtime/useBoard';
import { ElementRenderer } from './ElementRenderer';
import { textBoxHeight } from './text-layout';

type Tool =
	| 'select'
	| 'hand'
	| 'pencil'
	| 'highlighter'
	| 'rectangle'
	| 'ellipse'
	| 'diamond'
	| 'line'
	| 'arrow'
	| 'text'
	| 'sticky'
	| 'frame'
	| 'eraser';
const CLOSED_SHAPES: BoardElement['type'][] = ['rectangle', 'ellipse', 'diamond', 'sticky', 'frame'];
interface Viewport {
	x: number;
	y: number;
	zoom: number;
}
interface HistoryEntry {
	operation: BoardOperation;
	inverse: BoardOperation;
}

const TOOLS: Array<{ id: Tool; label: string; icon: typeof MousePointer2; key?: string }> = [
	{ id: 'select', label: 'Select', icon: MousePointer2, key: 'V' },
	{ id: 'hand', label: 'Pan', icon: Hand, key: 'H' },
	{ id: 'pencil', label: 'Draw', icon: Pencil, key: 'P' },
	{ id: 'highlighter', label: 'Highlighter', icon: Highlighter },
	{ id: 'rectangle', label: 'Text box', icon: RectangleHorizontal, key: 'R' },
	{ id: 'ellipse', label: 'Ellipse', icon: Circle, key: 'O' },
	{ id: 'diamond', label: 'Diamond', icon: Diamond, key: 'D' },
	{ id: 'line', label: 'Line', icon: Minus, key: 'L' },
	{ id: 'arrow', label: 'Arrow', icon: ArrowUp, key: 'A' },
	{ id: 'text', label: 'Text', icon: Type, key: 'T' },
	{ id: 'sticky', label: 'Sticky note', icon: StickyNote, key: 'S' },
	{ id: 'frame', label: 'Frame', icon: Frame, key: 'F' },
	{ id: 'eraser', label: 'Eraser', icon: Eraser, key: 'E' },
];

/** Renders an editable or view-only board according to the supplied capability. */
export function WhiteboardPage({ boardId, token }: { boardId: string; token: string }) {
	const board = useBoard(boardId, token);
	const [tool, setTool] = useState<Tool>('rectangle');
	const [selection, setSelection] = useState<string[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
	const [drafts, setDrafts] = useState<Map<string, BoardElement>>(new Map());
	const [shareOpen, setShareOpen] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [style, setStyle] = useState<ElementStyle>(DEFAULT_STYLE);
	const [copied, setCopied] = useState('');
	const svgRef = useRef<SVGSVGElement>(null);
	const textEditorRef = useRef<HTMLTextAreaElement>(null);
	const importRef = useRef<HTMLInputElement>(null);
	const historyRef = useRef<HistoryEntry[]>([]);
	const redoRef = useRef<HistoryEntry[]>([]);
	const clipboardRef = useRef<BoardElement[]>([]);
	const pointerRef = useRef<
		| { kind: 'draw'; start: Point; element: BoardElement }
		| { kind: 'connect'; source: BoardElement; element: BoardElement }
		| { kind: 'move'; start: Point; originals: BoardElement[] }
		| { kind: 'resize'; start: Point; original: BoardElement }
		| { kind: 'pan'; client: Point; viewport: Viewport }
		| null
	>(null);
	const lastShapeClickRef = useRef<{ id: string; at: number } | null>(null);
	const lastPresenceRef = useRef(0);

	const renderedElements = useMemo(() => {
		const merged = new Map(board.elements);
		for (const [id, element] of drafts) merged.set(id, element);
		return [...merged.values()].sort((a, b) => a.zIndex - b.zIndex);
	}, [board.elements, drafts]);
	const selected = selection.map((id) => drafts.get(id) ?? board.elements.get(id)).filter(Boolean) as BoardElement[];
	const editingElement = editingId ? (drafts.get(editingId) ?? board.elements.get(editingId)) : undefined;

	useEffect(() => {
		if (!editingId) return;
		textEditorRef.current?.focus();
	}, [editingId]);

	const inverseFor = useCallback(
		(operation: BoardOperation): BoardOperation | null => {
			if (operation.action === 'put') {
				const current = board.elements.get(operation.element.id);
				return current ? { action: 'put', element: current } : { action: 'delete', elementId: operation.element.id };
			}
			if (operation.action === 'delete') {
				const current = board.elements.get(operation.elementId);
				return current ? { action: 'put', element: current } : null;
			}
			if (operation.action === 'title' && board.metadata) return { action: 'title', title: board.metadata.title };
			return null;
		},
		[board.elements, board.metadata],
	);

	const commit = useCallback(
		(operation: BoardOperation, record = true) => {
			const inverse = inverseFor(operation);
			if (board.commit(operation) && record && inverse) {
				historyRef.current = [...historyRef.current.slice(-99), { operation, inverse }];
				redoRef.current = [];
			}
		},
		[board, inverseFor],
	);

	const undo = useCallback(() => {
		const entry = historyRef.current.pop();
		if (!entry) return;
		board.commit(entry.inverse);
		redoRef.current.push(entry);
	}, [board]);
	const redo = useCallback(() => {
		const entry = redoRef.current.pop();
		if (!entry) return;
		board.commit(entry.operation);
		historyRef.current.push(entry);
	}, [board]);

	const deleteSelection = useCallback(() => {
		for (const id of selection) commit({ action: 'delete', elementId: id });
		setSelection([]);
	}, [commit, selection]);

	const duplicateSelection = useCallback(() => {
		const next: string[] = [];
		for (const element of selected) {
			const copy = { ...element, id: crypto.randomUUID(), x: element.x + 24, y: element.y + 24, zIndex: Date.now() };
			commit({ action: 'put', element: copy });
			next.push(copy.id);
		}
		setSelection(next);
	}, [commit, selected]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
			const command = event.metaKey || event.ctrlKey;
			if (command && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
				return;
			}
			if (command && event.key.toLowerCase() === 'd') {
				event.preventDefault();
				duplicateSelection();
				return;
			}
			if (command && event.key.toLowerCase() === 'c') {
				clipboardRef.current = selected;
				return;
			}
			if (command && event.key.toLowerCase() === 'v' && clipboardRef.current.length) {
				event.preventDefault();
				const copies = clipboardRef.current.map((item) => ({
					...item,
					id: crypto.randomUUID(),
					x: item.x + 32,
					y: item.y + 32,
					zIndex: Date.now(),
				}));
				for (const copy of copies) commit({ action: 'put', element: copy });
				setSelection(copies.map((copy) => copy.id));
				return;
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				deleteSelection();
				return;
			}
			const match = TOOLS.find((item) => item.key?.toLowerCase() === event.key.toLowerCase());
			if (match && !command) setTool(match.id);
			if (event.key === 'Escape') {
				setSelection([]);
				setTool('select');
			}
			if (selection.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
				event.preventDefault();
				const amount = event.shiftKey ? 10 : 1;
				const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
				const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
				for (const element of selected) commit({ action: 'put', element: { ...element, x: element.x + dx, y: element.y + dy } });
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [commit, deleteSelection, duplicateSelection, redo, selected, selection.length, undo]);

	function worldPoint(event: React.PointerEvent<SVGSVGElement>): Point {
		const rect = svgRef.current!.getBoundingClientRect();
		return { x: (event.clientX - rect.left - viewport.x) / viewport.zoom, y: (event.clientY - rect.top - viewport.y) / viewport.zoom };
	}

	function findTarget(event: React.PointerEvent<SVGSVGElement>) {
		const target = (event.target as Element).closest('[data-element-id], [data-selection-id]');
		return target?.getAttribute('data-element-id') ?? target?.getAttribute('data-selection-id') ?? null;
	}

	function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
		if (board.permission === 'view') {
			pointerRef.current = { kind: 'pan', client: { x: event.clientX, y: event.clientY }, viewport };
			return;
		}
		const point = worldPoint(event);
		const targetId = findTarget(event);
		if (tool === 'hand' || event.button === 1 || event.buttons === 4) {
			svgRef.current?.setPointerCapture(event.pointerId);
			pointerRef.current = { kind: 'pan', client: { x: event.clientX, y: event.clientY }, viewport };
			return;
		}
		if (tool === 'select') {
			if (!targetId) {
				if (!event.shiftKey) setSelection([]);
				return;
			}
			const target = board.elements.get(targetId);
			const previousClick = lastShapeClickRef.current;
			if (target && previousClick?.id === targetId && event.timeStamp - previousClick.at < 450) {
				lastShapeClickRef.current = null;
				beginTextEditing(target);
				return;
			}
			lastShapeClickRef.current = { id: targetId, at: event.timeStamp };
			const nextSelection = event.shiftKey ? [...new Set([...selection, targetId])] : selection.includes(targetId) ? selection : [targetId];
			setSelection(nextSelection);
			const originals = nextSelection.map((id) => board.elements.get(id)).filter((item) => item && !item.locked) as BoardElement[];
			pointerRef.current = { kind: 'move', start: point, originals };
			return;
		}
		if (tool === 'eraser') {
			if (targetId) commit({ action: 'delete', elementId: targetId });
			return;
		}

		svgRef.current?.setPointerCapture(event.pointerId);
		const element = createElement(tool, point, style);
		pointerRef.current = { kind: 'draw', start: point, element };
		setDrafts(new Map([[element.id, element]]));
		setSelection([element.id]);
	}

	function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
		const gesture = pointerRef.current;
		const point = worldPoint(event);
		if (event.timeStamp - lastPresenceRef.current > 50) {
			board.sendPresence({ x: point.x, y: point.y, selectedIds: selection, tool });
			lastPresenceRef.current = event.timeStamp;
		}
		if (!gesture) return;
		if (gesture.kind === 'pan') {
			setViewport({
				...gesture.viewport,
				x: gesture.viewport.x + event.clientX - gesture.client.x,
				y: gesture.viewport.y + event.clientY - gesture.client.y,
			});
			return;
		}
		if (gesture.kind === 'move') {
			const dx = point.x - gesture.start.x,
				dy = point.y - gesture.start.y;
			setDrafts(new Map(gesture.originals.map((element) => [element.id, { ...element, x: element.x + dx, y: element.y + dy }])));
			return;
		}
		if (gesture.kind === 'resize') {
			setDrafts(
				new Map([
					[
						gesture.original.id,
						{ ...gesture.original, width: Math.max(10, point.x - gesture.original.x), height: Math.max(10, point.y - gesture.original.y) },
					],
				]),
			);
			return;
		}
		if (gesture.kind === 'connect') {
			gesture.element = {
				...gesture.element,
				width: point.x - gesture.element.x,
				height: point.y - gesture.element.y,
			};
			setDrafts(new Map([[gesture.element.id, gesture.element]]));
			return;
		}
		const updated = updateDrawnElement(gesture.element, gesture.start, point);
		gesture.element = updated;
		setDrafts(new Map([[updated.id, updated]]));
	}

	function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
		if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
		const gesture = pointerRef.current;
		pointerRef.current = null;
		if (!gesture || gesture.kind === 'pan') return;
		if (gesture.kind === 'connect') {
			const point = worldPoint(event);
			const target = [...board.elements.values()]
				.reverse()
				.find((element) => element.id !== gesture.source.id && CLOSED_SHAPES.includes(element.type) && containsPoint(element, point));
			setDrafts(new Map());
			if (target) {
				const { start, end } = connectorPoints(gesture.source, target);
				const arrow = {
					...gesture.element,
					x: start.x,
					y: start.y,
					width: end.x - start.x,
					height: end.y - start.y,
				};
				commit({ action: 'put', element: arrow });
				setSelection([arrow.id]);
			} else setSelection([gesture.source.id]);
			return;
		}
		const final = [...drafts.values()];
		let textBox: BoardElement | undefined;
		setDrafts(new Map());
		for (const element of final) {
			const drawable =
				(element.type === 'freehand' || element.type === 'highlighter') && element.points?.length === 1
					? { ...element, points: [...element.points, { x: element.points[0].x + 0.1, y: element.points[0].y + 0.1 }] }
					: element;
			const next =
				gesture.kind === 'draw' && drawable.type === 'rectangle'
					? { ...drawable, width: Math.max(160, drawable.width), height: Math.max(64, drawable.height), text: '' }
					: drawable;
			commit({ action: 'put', element: next });
			if (gesture.kind === 'draw' && next.type === 'rectangle') textBox = next;
		}
		if (textBox) {
			setSelection([textBox.id]);
			setDrafts(new Map([[textBox.id, textBox]]));
			setEditingId(textBox.id);
		}
		if (gesture.kind === 'draw' && !event.shiftKey) setTool('select');
	}

	function beginTextEditing(element: BoardElement) {
		if (board.permission !== 'edit' || ![...CLOSED_SHAPES, 'text'].includes(element.type)) return;
		setSelection([element.id]);
		setDrafts((current) => new Map(current).set(element.id, element));
		setEditingId(element.id);
		setTool('select');
	}

	function beginConnection(event: React.PointerEvent<SVGElement>, source: BoardElement) {
		event.stopPropagation();
		const start = { x: source.x + source.width, y: source.y + source.height / 2 };
		const arrow = createElement('arrow', start, style);
		pointerRef.current = { kind: 'connect', source, element: arrow };
		setDrafts(new Map([[arrow.id, arrow]]));
		svgRef.current?.setPointerCapture(event.pointerId);
	}

	function finishTextEditing() {
		if (!editingId) return;
		const element = drafts.get(editingId);
		if (element) commit({ action: 'put', element });
		setDrafts((current) => {
			const next = new Map(current);
			next.delete(editingId);
			return next;
		});
		setEditingId(null);
	}

	function onDoubleClick(event: React.MouseEvent<SVGSVGElement>) {
		const targetId = (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id');
		const element = targetId ? (drafts.get(targetId) ?? board.elements.get(targetId)) : undefined;
		if (element) beginTextEditing(element);
	}

	function beginResize(event: React.PointerEvent<SVGCircleElement>, element: BoardElement) {
		event.stopPropagation();
		pointerRef.current = { kind: 'resize', start: worldPoint(event as unknown as React.PointerEvent<SVGSVGElement>), original: element };
		svgRef.current?.setPointerCapture(event.pointerId);
	}

	function onWheel(event: React.WheelEvent<SVGSVGElement>) {
		event.preventDefault();
		if (event.ctrlKey || event.metaKey) {
			const factor = event.deltaY > 0 ? 0.9 : 1.1;
			setViewport((current) => ({ ...current, zoom: Math.min(4, Math.max(0.15, current.zoom * factor)) }));
		} else setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
	}

	function updateSelected(changes: Partial<BoardElement> | { style: Partial<ElementStyle> }) {
		for (const element of selected) {
			const next = 'style' in changes ? { ...element, style: { ...element.style, ...changes.style } } : { ...element, ...changes };
			commit({ action: 'put', element: next });
		}
	}

	function align(axis: 'x' | 'y') {
		if (selected.length < 2) return;
		const min = Math.min(...selected.map((element) => (axis === 'x' ? element.x : element.y)));
		const max = Math.max(...selected.map((element) => (axis === 'x' ? element.x + element.width : element.y + element.height)));
		const center = (min + max) / 2;
		for (const element of selected)
			commit({ action: 'put', element: { ...element, [axis]: center - (axis === 'x' ? element.width : element.height) / 2 } });
	}

	function group(grouped: boolean) {
		const groupId = grouped ? crypto.randomUUID() : undefined;
		for (const element of selected) commit({ action: 'put', element: { ...element, groupId } });
	}

	function fitBoard() {
		if (!renderedElements.length || !svgRef.current) {
			setViewport({ x: 0, y: 0, zoom: 1 });
			return;
		}
		const bounds = renderedElements.map(elementBounds);
		const minX = Math.min(...bounds.map((item) => item.x)),
			minY = Math.min(...bounds.map((item) => item.y));
		const maxX = Math.max(...bounds.map((item) => item.x + item.width)),
			maxY = Math.max(...bounds.map((item) => item.y + item.height));
		const rect = svgRef.current.getBoundingClientRect();
		const zoom = Math.min(
			2,
			Math.max(0.15, Math.min((rect.width - 160) / Math.max(100, maxX - minX), (rect.height - 160) / Math.max(100, maxY - minY))),
		);
		setViewport({ zoom, x: rect.width / 2 - ((minX + maxX) / 2) * zoom, y: rect.height / 2 - ((minY + maxY) / 2) * zoom });
	}

	async function importBoard(file: File) {
		try {
			const parsed = JSON.parse(await file.text()) as { elements?: unknown[] };
			if (!Array.isArray(parsed.elements) || parsed.elements.length > 2_000) throw new Error('Invalid board file');
			const imported = parsed.elements.map((element) => boardElementSchema.parse(element));
			if (!window.confirm(`Replace this board with ${imported.length} imported elements?`)) return;
			commit({ action: 'clear' });
			for (const element of imported) commit({ action: 'put', element });
			setSelection([]);
		} catch {
			window.alert('That file is not a valid Cloudflare Whiteboard JSON export.');
		}
	}

	if (board.status === 'invalid') return <InvalidBoard />;

	return (
		<div className="whiteboard-app">
			<header className="board-header">
				<a href="/" aria-label="Back to home">
					<Logo compact />
				</a>
				<input
					className="board-title"
					aria-label="Board title"
					defaultValue={board.metadata?.title ?? 'Untitled whiteboard'}
					key={board.metadata?.title}
					disabled={board.permission === 'view'}
					onBlur={(event) => {
						const title = event.target.value.trim();
						if (title && title !== board.metadata?.title) commit({ action: 'title', title });
					}}
				/>
				<span className={`connection-state ${board.status}`}>
					<i />
					{board.status}
				</span>
				<div className="presence-stack" aria-label={`${board.participants.size + 1} participants`}>
					<ParticipantDot person={{ displayName: board.identity.name, color: board.identity.color }} />
					{[...board.participants.values()].slice(0, 3).map((person) => (
						<ParticipantDot key={person.participantId} person={person} />
					))}
					{board.participants.size > 3 && <span>+{board.participants.size - 3}</span>}
				</div>
				<button className="icon-button mobile-menu" onClick={() => setInspectorOpen((open) => !open)} aria-label="Open menu">
					<Menu />
				</button>
				<div className="export-control">
					<button className="button small ghost" onClick={() => setExportOpen((open) => !open)}>
						<Download size={16} /> Export
					</button>
					{exportOpen && (
						<div className="export-menu">
							<button onClick={() => exportBoard('png', renderedElements, svgRef.current)}>PNG image</button>
							<button onClick={() => exportBoard('svg', renderedElements, svgRef.current)}>SVG document</button>
							<button onClick={() => exportBoard('json', renderedElements, svgRef.current)}>Board JSON</button>
							{board.permission === 'edit' && (
								<button onClick={() => importRef.current?.click()}>
									<Upload size={14} /> Import JSON
								</button>
							)}
						</div>
					)}
				</div>
				{board.permission === 'edit' && (
					<input
						ref={importRef}
						className="visually-hidden"
						type="file"
						accept="application/json,.json"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) void importBoard(file);
							event.target.value = '';
						}}
					/>
				)}
				<button className="button small primary" onClick={() => setShareOpen(true)}>
					<Share2 size={16} /> Share
				</button>
			</header>

			<div className="board-workspace">
				{board.permission === 'edit' && (
					<aside className="tool-rail" aria-label="Drawing tools">
						{TOOLS.map(({ id, label, icon: Icon, key }) => (
							<button
								key={id}
								className={tool === id ? 'active' : ''}
								onClick={() => setTool(id)}
								aria-label={`${label}${key ? ` (${key})` : ''}`}
								title={`${label}${key ? ` (${key})` : ''}`}
							>
								<Icon />
							</button>
						))}
					</aside>
				)}
				<div className="canvas-wrap">
					<svg
						ref={svgRef}
						className={`board-svg tool-${tool}`}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onDoubleClick={onDoubleClick}
						onWheel={onWheel}
						role="application"
						aria-label="Collaborative whiteboard canvas"
					>
						<defs>
							<pattern
								id="canvas-dots"
								width={24 * viewport.zoom}
								height={24 * viewport.zoom}
								patternUnits="userSpaceOnUse"
								patternTransform={`translate(${viewport.x % (24 * viewport.zoom)} ${viewport.y % (24 * viewport.zoom)})`}
							>
								<circle cx="1" cy="1" r="1" fill="var(--dot)" />
							</pattern>
							<marker id="board-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
								<path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
							</marker>
						</defs>
						<rect width="100%" height="100%" fill="url(#canvas-dots)" />
						<g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
							{renderedElements.map((element) => (
								<ElementRenderer key={element.id} element={element} onDoubleClick={beginTextEditing} />
							))}
							{selected.map((element) => (
								<g key={`selection-${element.id}`} className="non-export" pointerEvents="none">
									<rect
										x={element.x - 5}
										y={element.y - 5}
										width={element.width + 10}
										height={element.height + 10}
										fill="none"
										stroke="#0A95FF"
										strokeWidth={1.5 / viewport.zoom}
										pointerEvents="none"
										strokeDasharray={`${5 / viewport.zoom} ${4 / viewport.zoom}`}
									/>
									<circle
										cx={element.x + element.width + 5}
										cy={element.y + element.height + 5}
										r={7 / viewport.zoom}
										fill="#fff"
										stroke="#0A95FF"
										strokeWidth={1.5 / viewport.zoom}
										pointerEvents="all"
										onPointerDown={(event) => beginResize(event, element)}
									/>
									{selected.length === 1 && CLOSED_SHAPES.includes(element.type) && !editingId && !element.locked && (
										<g
											className="connector-handle"
											pointerEvents="all"
											transform={`translate(${element.x + element.width + 25} ${element.y + element.height / 2})`}
											onPointerDown={(event) => beginConnection(event, element)}
										>
											<circle r={10 / viewport.zoom} fill="#0A95FF" stroke="#fff" strokeWidth={2 / viewport.zoom} />
											<path
												d={`M ${-4 / viewport.zoom} 0 H ${4 / viewport.zoom} M ${1 / viewport.zoom} ${-3 / viewport.zoom} L ${4 / viewport.zoom} 0 L ${1 / viewport.zoom} ${3 / viewport.zoom}`}
												fill="none"
												stroke="#fff"
												strokeWidth={1.5 / viewport.zoom}
											/>
										</g>
									)}
								</g>
							))}
							{[...board.participants.values()].map((person) => (
								<RemoteCursor key={person.participantId} person={person} />
							))}
						</g>
					</svg>
					{editingElement && (
						<textarea
							ref={textEditorRef}
							className="canvas-text-editor"
							aria-label="Text box content"
							placeholder="Type something..."
							value={editingElement.text ?? ''}
							onPointerDown={(event) => event.stopPropagation()}
							onChange={(event) => {
								const text = event.target.value;
								const next = {
									...editingElement,
									text,
									height: Math.max(editingElement.height, textBoxHeight(text, editingElement.width, editingElement.style.fontSize)),
								};
								setDrafts((current) => new Map(current).set(next.id, next));
							}}
							onBlur={finishTextEditing}
							onKeyDown={(event) => {
								if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) event.currentTarget.blur();
							}}
							style={{
								left: viewport.x + (editingElement.x + 12) * viewport.zoom,
								top: viewport.y + (editingElement.y + 10) * viewport.zoom,
								width: Math.max(60, (editingElement.width - 24) * viewport.zoom),
								height: Math.max(40, (editingElement.height - 20) * viewport.zoom),
								fontSize: editingElement.style.fontSize * viewport.zoom,
								color: editingElement.style.stroke,
								textAlign: editingElement.style.textAlign,
							}}
						/>
					)}
					<div className="canvas-actions">
						<button onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(0.15, v.zoom / 1.2) }))} aria-label="Zoom out">
							<ZoomOut />
						</button>
						<button onClick={() => setViewport((v) => ({ ...v, zoom: 1 }))}>{Math.round(viewport.zoom * 100)}%</button>
						<button onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(4, v.zoom * 1.2) }))} aria-label="Zoom in">
							<ZoomIn />
						</button>
						<button onClick={fitBoard}>Fit</button>
					</div>
					{board.permission === 'view' && <span className="view-badge">View only</span>}
					{board.status !== 'connected' && (
						<div className="reconnect-banner">
							{board.status === 'connecting' ? 'Connecting to the board...' : 'Connection lost. Reconnecting...'}
						</div>
					)}
				</div>

				{board.permission === 'edit' && (
					<aside className={`inspector ${inspectorOpen ? 'open' : ''}`}>
						<div className="inspector-heading">
							<strong>{selected.length ? `${selected.length} selected` : 'Drawing style'}</strong>
							<button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label="Close inspector">
								×
							</button>
						</div>
						<label>
							Stroke
							<input
								type="color"
								value={selected[0]?.style.stroke ?? style.stroke}
								onChange={(event) =>
									selected.length
										? updateSelected({ style: { stroke: event.target.value } })
										: setStyle((current) => ({ ...current, stroke: event.target.value }))
								}
							/>
						</label>
						<label>
							Fill
							<select
								value={selected[0]?.style.fill ?? style.fill}
								onChange={(event) =>
									selected.length
										? updateSelected({ style: { fill: event.target.value } })
										: setStyle((current) => ({ ...current, fill: event.target.value }))
								}
							>
								<option value="transparent">Transparent</option>
								<option value="#EAF6FF">Blue</option>
								<option value="#FFF3AE">Yellow</option>
								<option value="#E9FAF3">Green</option>
								<option value="#F6ECFF">Purple</option>
								<option value="#FFF0EB">Orange</option>
							</select>
						</label>
						<label>
							Width
							<input
								type="range"
								min="1"
								max="12"
								value={selected[0]?.style.strokeWidth ?? style.strokeWidth}
								onChange={(event) => {
									const strokeWidth = Number(event.target.value);
									if (selected.length) updateSelected({ style: { strokeWidth } });
									else setStyle((current) => ({ ...current, strokeWidth }));
								}}
							/>
						</label>
						<label>
							Line
							<select
								value={selected[0]?.style.dash ?? style.dash}
								onChange={(event) => {
									const dash = event.target.value as ElementStyle['dash'];
									if (selected.length) updateSelected({ style: { dash } });
									else setStyle((current) => ({ ...current, dash }));
								}}
							>
								<option value="solid">Solid</option>
								<option value="dashed">Dashed</option>
								<option value="dotted">Dotted</option>
							</select>
						</label>
						{selected.length === 1 && [...CLOSED_SHAPES, 'text'].includes(selected[0].type) && (
							<label>
								Text
								<textarea
									value={selected[0].text ?? ''}
									onFocus={() => beginTextEditing(selected[0])}
									onChange={(event) =>
										updateSelected({
											text: event.target.value,
											height: Math.max(
												selected[0].height,
												textBoxHeight(event.target.value, selected[0].width, selected[0].style.fontSize),
											),
										})
									}
								/>
							</label>
						)}
						{selected.length > 0 && (
							<div className="inspector-actions">
								<button onClick={duplicateSelection}>
									<Copy />
									Duplicate
								</button>
								<button onClick={() => updateSelected({ locked: !selected.every((item) => item.locked) })}>
									{selected.every((item) => item.locked) ? <Unlock /> : <Lock />}
									{selected.every((item) => item.locked) ? 'Unlock' : 'Lock'}
								</button>
								<button onClick={() => align('x')} disabled={selected.length < 2}>
									<AlignCenterHorizontal />
									Align H
								</button>
								<button onClick={() => align('y')} disabled={selected.length < 2}>
									<AlignCenterVertical />
									Align V
								</button>
								<button onClick={() => group(true)} disabled={selected.length < 2}>
									<Group />
									Group
								</button>
								<button onClick={() => group(false)}>
									<Ungroup />
									Ungroup
								</button>
								<button
									onClick={() => {
										for (const element of selected) commit({ action: 'put', element: { ...element, zIndex: Date.now() } });
									}}
								>
									<ArrowUp />
									Front
								</button>
								<button
									onClick={() => {
										for (const element of selected) commit({ action: 'put', element: { ...element, zIndex: -Date.now() } });
									}}
								>
									<ArrowDown />
									Back
								</button>
								<button className="danger" onClick={deleteSelection}>
									<Trash2 />
									Delete
								</button>
							</div>
						)}
						<div className="history-controls">
							<button onClick={undo}>
								<Undo2 /> Undo
							</button>
							<button onClick={redo}>
								<Redo2 /> Redo
							</button>
						</div>
						<div className="expiry-note">
							Edits keep this board available until{' '}
							<strong>{board.metadata ? new Date(board.metadata.expiresAt).toLocaleDateString() : '30 days from now'}</strong>.
						</div>
					</aside>
				)}
			</div>
			{shareOpen && (
				<ShareDialog
					boardId={boardId}
					token={token}
					permission={board.permission}
					copied={copied}
					setCopied={setCopied}
					onClose={() => setShareOpen(false)}
				/>
			)}
		</div>
	);
}

function createElement(tool: Tool, point: Point, style: ElementStyle): BoardElement {
	const type: ElementType = tool === 'pencil' ? 'freehand' : (tool as ElementType);
	const text = tool === 'sticky' ? 'New idea' : tool === 'text' ? 'Type something' : undefined;
	return {
		id: crypto.randomUUID(),
		type,
		x: point.x,
		y: point.y,
		width: tool === 'text' ? 180 : 1,
		height: tool === 'text' ? 40 : 1,
		rotation: 0,
		points: ['pencil', 'highlighter'].includes(tool) ? [{ x: 0, y: 0 }] : undefined,
		text,
		style: { ...style, fill: tool === 'sticky' ? '#FFF3AE' : style.fill },
		zIndex: Date.now(),
	};
}

function containsPoint(element: BoardElement, point: Point): boolean {
	const bounds = elementBounds(element);
	return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function connectorPoints(source: BoardElement, target: BoardElement): { start: Point; end: Point } {
	const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
	const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
	return {
		start: edgePoint(source, targetCenter),
		end: edgePoint(target, sourceCenter),
	};
}

function edgePoint(element: BoardElement, toward: Point): Point {
	const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
	const dx = toward.x - center.x;
	const dy = toward.y - center.y;
	const horizontal = Math.abs(dx) / Math.max(1, element.width) >= Math.abs(dy) / Math.max(1, element.height);
	return horizontal
		? { x: dx >= 0 ? element.x + element.width : element.x, y: center.y }
		: { x: center.x, y: dy >= 0 ? element.y + element.height : element.y };
}

function updateDrawnElement(element: BoardElement, start: Point, point: Point): BoardElement {
	if (element.type === 'freehand' || element.type === 'highlighter')
		return { ...element, points: [...(element.points ?? []), { x: point.x - element.x, y: point.y - element.y }] };
	if (element.type === 'line' || element.type === 'arrow') return { ...element, width: point.x - start.x, height: point.y - start.y };
	return {
		...element,
		x: Math.min(start.x, point.x),
		y: Math.min(start.y, point.y),
		width: Math.max(1, Math.abs(point.x - start.x)),
		height: Math.max(1, Math.abs(point.y - start.y)),
	};
}

function ParticipantDot({ person }: { person: Pick<Presence, 'displayName' | 'color'> }) {
	return (
		<span className="participant-dot" title={person.displayName} style={{ background: person.color }}>
			{person.displayName
				.split(' ')
				.map((word) => word[0])
				.join('')}
		</span>
	);
}

function RemoteCursor({ person }: { person: Presence }) {
	return (
		<g className="remote-cursor non-export" transform={`translate(${person.x} ${person.y})`}>
			<path d="M0 0 L4 18 L9 11 L17 17 L21 12 L13 7 L20 3 Z" fill={person.color} stroke="#fff" strokeWidth="1.5" />
			<rect x="16" y="17" width={person.displayName.length * 7 + 12} height="22" rx="5" fill={person.color} />
			<text x="22" y="32" fill="#fff" fontSize="12">
				{person.displayName}
			</text>
		</g>
	);
}

function ShareDialog({
	boardId,
	token,
	permission,
	copied,
	setCopied,
	onClose,
}: {
	boardId: string;
	token: string;
	permission: 'edit' | 'view';
	copied: string;
	setCopied: (value: string) => void;
	onClose: () => void;
}) {
	const stored = sessionStorage.getItem(`board-share-${boardId}`);
	const created = stored ? (JSON.parse(stored) as { editToken: string; viewToken: string }) : null;
	const origin = window.location.origin;
	const links = created
		? [
				['Can edit', `${origin}/board/${boardId}#edit=${created.editToken}`],
				['Can view', `${origin}/board/${boardId}#view=${created.viewToken}`],
			]
		: [[permission === 'edit' ? 'Can edit' : 'Can view', `${origin}/board/${boardId}#${permission}=${token}`]];
	async function copy(label: string, value: string) {
		await navigator.clipboard.writeText(value);
		setCopied(label);
		window.setTimeout(() => setCopied(''), 1_500);
	}
	return (
		<div className="modal-backdrop" onPointerDown={onClose}>
			<section
				className="share-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="share-title"
				onPointerDown={(event) => event.stopPropagation()}
			>
				<button className="modal-close" onClick={onClose} aria-label="Close">
					×
				</button>
				<span className="eyebrow">
					<UsersRound size={14} /> Invite collaborators
				</span>
				<h3 id="share-title">Share this whiteboard</h3>
				<p>Anyone with a capability link can access this board. Links cannot be revoked in this reference version.</p>
				{links.map(([label, link]) => (
					<label className="share-link" key={label}>
						<span>{label}</span>
						<div>
							<input readOnly value={link} />
							<button onClick={() => void copy(label, link)}>{copied === label ? 'Copied' : 'Copy link'}</button>
						</div>
					</label>
				))}
				<div className="share-warning">
					Board content is unmoderated and expires after 30 days without an edit. Do not use it for sensitive information.
				</div>
			</section>
		</div>
	);
}

function exportBoard(format: 'json' | 'svg' | 'png', elements: BoardElement[], svg: SVGSVGElement | null) {
	if (format === 'json') {
		download(new Blob([JSON.stringify({ version: 1, elements }, null, 2)], { type: 'application/json' }), 'cloudflare-whiteboard.json');
		return;
	}
	if (!svg) return;
	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.querySelectorAll('.non-export').forEach((node) => node.remove());
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	const source = new XMLSerializer().serializeToString(clone);
	if (format === 'svg') {
		download(new Blob([source], { type: 'image/svg+xml' }), 'cloudflare-whiteboard.svg');
		return;
	}
	const image = new Image();
	const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
	image.onload = () => {
		const canvas = document.createElement('canvas');
		canvas.width = svg.clientWidth * 2;
		canvas.height = svg.clientHeight * 2;
		const context = canvas.getContext('2d');
		context?.drawImage(image, 0, 0, canvas.width, canvas.height);
		URL.revokeObjectURL(url);
		canvas.toBlob((blob) => {
			if (blob) download(blob, 'cloudflare-whiteboard.png');
		});
	};
	image.src = url;
}

function download(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function InvalidBoard() {
	return (
		<main className="invalid-board">
			<Logo />
			<span className="eyebrow">Board unavailable</span>
			<h1>This whiteboard has expired or the link is invalid.</h1>
			<p>Anonymous boards are removed after 30 days without an edit.</p>
			<a className="button primary" href="/">
				Create a new board
			</a>
		</main>
	);
}
