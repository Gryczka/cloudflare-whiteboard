/** Safe SVG renderer for every validated whiteboard element type. */
import type { BoardElement } from '../../shared/board';
import { wrapTextLines } from './text-layout';

function dashArray(dash: BoardElement['style']['dash']) {
	if (dash === 'dashed') return '10 7';
	if (dash === 'dotted') return '2 7';
	return undefined;
}

/** Converts a structured board element into SVG without raw markup injection. */
export function ElementRenderer({ element, onDoubleClick }: { element: BoardElement; onDoubleClick?: (element: BoardElement) => void }) {
	const { style } = element;
	const common = {
		stroke: style.stroke,
		fill: style.fill,
		strokeWidth: style.strokeWidth,
		strokeDasharray: dashArray(style.dash),
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
		opacity: style.opacity,
		vectorEffect: 'non-scaling-stroke' as const,
	};
	const transform = `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`;

	let shape: React.ReactNode;
	if (element.type === 'rectangle' || element.type === 'frame' || element.type === 'sticky') {
		shape = (
			<rect
				x={element.x}
				y={element.y}
				width={element.width}
				height={element.height}
				rx={element.type === 'frame' ? 4 : 10}
				{...common}
				fill={element.type === 'sticky' && style.fill === 'transparent' ? '#FFF3AE' : style.fill}
			/>
		);
	} else if (element.type === 'ellipse') {
		shape = (
			<ellipse
				cx={element.x + element.width / 2}
				cy={element.y + element.height / 2}
				rx={element.width / 2}
				ry={element.height / 2}
				{...common}
			/>
		);
	} else if (element.type === 'diamond') {
		const points = `${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${element.x + element.width / 2},${element.y + element.height} ${element.x},${element.y + element.height / 2}`;
		shape = <polygon points={points} {...common} />;
	} else if (element.type === 'line' || element.type === 'arrow') {
		shape = (
			<line
				x1={element.x}
				y1={element.y}
				x2={element.x + element.width}
				y2={element.y + element.height}
				{...common}
				fill="none"
				markerEnd={element.type === 'arrow' ? 'url(#board-arrow)' : undefined}
			/>
		);
	} else if (element.type === 'freehand' || element.type === 'highlighter') {
		const path =
			element.points?.map((point, index) => `${index ? 'L' : 'M'} ${element.x + point.x} ${element.y + point.y}`).join(' ') ?? '';
		shape = (
			<path
				d={path}
				{...common}
				fill="none"
				strokeWidth={element.type === 'highlighter' ? Math.max(12, style.strokeWidth * 5) : style.strokeWidth}
				opacity={element.type === 'highlighter' ? 0.3 : style.opacity}
			/>
		);
	} else {
		shape = null;
	}

	const textLines = element.text
		? wrapTextLines(element.text, element.type === 'text' ? Number.MAX_SAFE_INTEGER : element.width, style.fontSize)
		: [];
	const textX =
		element.type === 'text'
			? element.x
			: element.x + (style.textAlign === 'center' ? element.width / 2 : style.textAlign === 'right' ? element.width - 14 : 14);
	return (
		<g
			data-element-id={element.id}
			transform={transform}
			className={element.locked ? 'element-locked' : undefined}
			onDoubleClick={(event) => {
				event.stopPropagation();
				onDoubleClick?.(element);
			}}
		>
			{shape}
			{textLines.length > 0 && (
				<text
					x={textX}
					y={element.y + (element.type === 'text' ? style.fontSize : style.fontSize + 12)}
					fill={style.stroke}
					fontSize={style.fontSize}
					textAnchor={style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start'}
					style={{ userSelect: 'none' }}
				>
					{textLines.map((line, index) => (
						<tspan key={`${line}-${index}`} x={textX} dy={index ? style.fontSize * 1.25 : 0}>
							{line}
						</tspan>
					))}
				</text>
			)}
		</g>
	);
}
