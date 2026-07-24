/** Deterministic text wrapping shared by SVG rendering and editor sizing. */

export function wrapTextLines(text: string, width: number, fontSize: number): string[] {
	if (!text) return [];
	const maxCharacters = Math.max(1, Math.floor(Math.max(1, width - 28) / (fontSize * 0.56)));
	return text.split('\n').flatMap((paragraph) => {
		if (!paragraph) return [''];
		const lines: string[] = [];
		let line = '';
		for (const word of paragraph.split(/\s+/)) {
			const chunks = word.match(new RegExp(`.{1,${maxCharacters}}`, 'g')) ?? [''];
			for (const chunk of chunks) {
				const candidate = line ? `${line} ${chunk}` : chunk;
				if (candidate.length <= maxCharacters) line = candidate;
				else {
					if (line) lines.push(line);
					line = chunk;
				}
			}
		}
		if (line) lines.push(line);
		return lines.length ? lines : [''];
	});
}

export function textBoxHeight(text: string, width: number, fontSize: number): number {
	return Math.max(64, wrapTextLines(text || ' ', width, fontSize).length * fontSize * 1.25 + 24);
}
