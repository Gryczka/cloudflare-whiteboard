/** Kumo-styled product page and anonymous board-creation flow. */
import { ArrowRight, Clock3, Code2, Database, MousePointer2, Network, Pencil, Share2, Sparkles, UsersRound, Zap } from 'lucide-react';
import { useState } from 'react';
import { CornerSquares } from '../components/CornerSquares';
import { Logo } from '../components/Logo';

interface CreatedBoard {
	boardId: string;
	editToken: string;
	viewToken: string;
}

/** Renders the public landing page and creates a board on demand. */
export function LandingPage() {
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState('');

	async function createBoard() {
		setCreating(true);
		setError('');
		try {
			const response = await fetch('/api/boards', { method: 'POST' });
			if (!response.ok) throw new Error('Could not create a board right now.');
			const board = await response.json<CreatedBoard>();
			sessionStorage.setItem(`board-share-${board.boardId}`, JSON.stringify(board));
			window.location.assign(`/board/${board.boardId}#edit=${board.editToken}`);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Could not create a board.');
			setCreating(false);
		}
	}

	return (
		<div className="landing">
			<div className="background-lines" aria-hidden="true">
				<div />
				<div />
			</div>
			<header className="site-nav">
				<a href="/" aria-label="Cloudflare Whiteboard home">
					<Logo />
				</a>
				<nav aria-label="Primary navigation">
					<a href="#features">Features</a>
					<a href="#architecture">Architecture</a>
					<a href="https://github.com/Gryczka" target="_blank" rel="noreferrer">
						<Code2 size={16} /> GitHub
					</a>
				</nav>
				<button className="button small primary" onClick={() => void createBoard()} disabled={creating}>
					{creating ? 'Opening...' : 'Start drawing'}
				</button>
			</header>

			<main className="landing-main gap-section">
				<section className="hero px-section">
					<div className="hero-copy">
						<span className="eyebrow">
							<Zap size={14} /> Durable collaboration
						</span>
						<h1>
							A shared canvas,
							<br />
							<span>coordinated at the edge.</span>
						</h1>
						<p>Create an anonymous whiteboard, invite collaborators, and watch one Durable Object keep every participant in sync.</p>
						<div className="hero-actions">
							<button className="button primary" onClick={() => void createBoard()} disabled={creating}>
								{creating ? 'Creating your board...' : 'Create a whiteboard'} <ArrowRight size={17} />
							</button>
							<a className="button ghost" href="#architecture">
								Explore the architecture
							</a>
						</div>
						{error && (
							<p className="form-error" role="alert">
								{error}
							</p>
						)}
						<div className="trust-line">
							<span>
								<i className="status-dot" /> No account required
							</span>
							<span>30-day persistence</span>
							<span>Separate edit + view links</span>
						</div>
					</div>
					<HeroBoard />
				</section>

				<section id="features" className="px-section section-animate visible">
					<h2 className="visually-hidden">Collaborative whiteboard features</h2>
					<div className="feature-wrapper">
						<CornerSquares />
						{[
							[
								UsersRound,
								'Draw together, instantly',
								'Live cursors, selections, and edits travel over one hibernatable WebSocket per participant.',
							],
							[
								Share2,
								'Share by capability',
								'Hand out a can-edit or view-only link. The Durable Object enforces the permission server-side.',
							],
							[
								Clock3,
								'Durable, not permanent',
								'SQLite keeps every shape safe through restarts, then an alarm cleans up after 30 inactive days.',
							],
						].map(([Icon, title, copy]) => (
							<article className="feature-card" key={String(title)}>
								<Icon size={24} />
								<h3>{String(title)}</h3>
								<p>{String(copy)}</p>
							</article>
						))}
					</div>
				</section>

				<section className="steps px-section">
					<div className="section-heading">
						<span className="eyebrow">How it works</span>
						<h2>From blank canvas to shared idea in seconds.</h2>
						<p>No workspace setup, invitations, or user provisioning.</p>
					</div>
					<div className="step-list">
						{[
							['Create a board', 'The Worker mints cryptographically random edit and view capabilities.'],
							['Share a link', 'Collaborators connect to the same board-specific Durable Object.'],
							['Make your mark', 'Committed changes are ordered, persisted to SQLite, then broadcast.'],
							['Export or return', 'Download PNG, SVG, or JSON before the 30-day inactivity window closes.'],
						].map(([title, copy], index) => (
							<div className="step" key={title}>
								<div className="step-rail">
									<span>{index + 1}</span>
									<i />
								</div>
								<div>
									<h3>{title}</h3>
									<p>{copy}</p>
								</div>
							</div>
						))}
					</div>
				</section>

				<section id="architecture" className="px-section architecture-section">
					<div className="section-heading">
						<span className="eyebrow">Built on Cloudflare</span>
						<h2>One board. One coordination point. Zero origin servers.</h2>
						<p>The architecture is deliberately small enough to learn from and strong enough to survive real collaboration.</p>
					</div>
					<div className="architecture-card">
						<CornerSquares />
						<ArchitectureDiagram />
					</div>
				</section>

				<section className="px-section use-cases">
					<div className="use-case-grid">
						<div className="use-case-intro">
							<span className="eyebrow">Made for momentum</span>
							<h2>Where ideas need room to move.</h2>
							<p>A focused tool for workshops, system design, teaching, and fast visual thinking.</p>
							<button className="button ghost" onClick={() => void createBoard()}>
								Open a blank board
							</button>
						</div>
						{[
							['Architecture reviews', 'Map systems with frames, arrows, labels, and a link the whole room can edit.'],
							['Remote workshops', 'See where everyone is working without managing accounts or permissions.'],
							['Teaching and demos', 'Share a view-only link, present full screen, then export the result.'],
							['Rapid ideation', 'Sketch, group, align, duplicate, and reorganize without breaking flow.'],
						].map(([title, copy]) => (
							<article key={title}>
								<Sparkles size={20} />
								<h3>{title}</h3>
								<p>{copy}</p>
							</article>
						))}
					</div>
				</section>

				<section className="cta-section px-section">
					<div className="cta-card">
						<h2>Turn the next thought into something everyone can see.</h2>
						<p>Open a board, share the link, and start drawing. No signup required.</p>
						<button className="button inverted" onClick={() => void createBoard()}>
							Create a whiteboard <ArrowRight size={18} />
						</button>
					</div>
					<div className="ticker">
						<div>
							{[
								'WORKERS',
								'DURABLE OBJECTS',
								'SQLITE',
								'WEBSOCKETS',
								'REACT + SVG',
								'WORKERS',
								'DURABLE OBJECTS',
								'SQLITE',
								'WEBSOCKETS',
								'REACT + SVG',
							].map((item, index) => (
								<span key={`${item}-${index}`}>✦ {item}</span>
							))}
						</div>
					</div>
				</section>
			</main>
			<footer className="site-footer">
				<Logo />
				<p>An unofficial reference project built for the gryczka.dev Unrefined App Garden.</p>
				<div>
					<a href="https://developers.cloudflare.com/durable-objects/">Durable Objects docs</a>
					<a href="https://github.com/Gryczka">Source</a>
				</div>
			</footer>
		</div>
	);
}

function HeroBoard() {
	return (
		<div className="hero-board">
			<div className="board-top">
				<span>Launch workshop</span>
				<div>
					<i />
					<i />
					<i /> +3
				</div>
			</div>
			<div className="board-canvas">
				<svg viewBox="0 0 620 400" role="img" aria-label="Preview of a collaborative product planning board">
					<defs>
						<pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
							<circle cx="1" cy="1" r="1" fill="#d4d4d4" />
						</pattern>
					</defs>
					<rect width="620" height="400" fill="url(#dots)" />
					<rect x="52" y="44" width="190" height="92" rx="10" fill="#EAF6FF" stroke="#0A95FF" />
					<text x="70" y="75">
						What should we build?
					</text>
					<text x="70" y="104" className="muted">
						Start with the customer
					</text>
					<path d="M242 90 C290 90 280 184 324 184" fill="none" stroke="#FF5E1F" strokeWidth="2" markerEnd="url(#arrow)" />
					<rect x="324" y="138" width="210" height="100" rx="10" fill="#FFF3AE" stroke="#D97706" />
					<text x="344" y="171">
						Shared visual workspace
					</text>
					<text x="344" y="201" className="muted">
						Fast, open, durable
					</text>
					<rect x="92" y="264" width="134" height="72" rx="10" fill="#F6ECFF" stroke="#9616FF" />
					<text x="111" y="306">
						Prototype
					</text>
					<rect x="286" y="280" width="134" height="72" rx="10" fill="#E9FAF3" stroke="#00A96E" />
					<text x="319" y="322">
						Test
					</text>
					<path d="M226 300 L286 313" stroke="#262626" strokeDasharray="5 5" />
					<g className="fake-cursor orange">
						<path d="M510 86l4 17 5-6 8 5 3-4-8-5 6-5z" />
						<text x="530" y="84">
							Amber Otter
						</text>
					</g>
					<g className="fake-cursor blue">
						<path d="M250 240l4 17 5-6 8 5 3-4-8-5 6-5z" />
						<text x="270" y="238">
							Brisk Falcon
						</text>
					</g>
				</svg>
				<div className="mock-tools">
					<MousePointer2 />
					<Pencil />
					<Code2 />
				</div>
			</div>
		</div>
	);
}

function ArchitectureDiagram() {
	return (
		<div className="arch-diagram">
			<div className="arch-node clients">
				<UsersRound />
				<strong>Browser clients</strong>
				<span>React + custom SVG</span>
			</div>
			<div className="arch-edge">
				<span>HTTPS + WebSocket</span>
				<i />
			</div>
			<div className="arch-node worker">
				<Network />
				<strong>Cloudflare Worker</strong>
				<span>Routing + static assets</span>
			</div>
			<div className="arch-edge">
				<span>getByName(boardId)</span>
				<i />
			</div>
			<div className="arch-hub">
				<Zap />
				<strong>Board Durable Object</strong>
				<span>Authoritative operation order</span>
			</div>
			<div className="arch-split">
				<i />
				<i />
			</div>
			<div className="arch-children">
				<div className="arch-node">
					<Database />
					<strong>SQLite</strong>
					<span>Elements + operation tail</span>
				</div>
				<div className="arch-node">
					<Clock3 />
					<strong>Alarm</strong>
					<span>30-day cleanup</span>
				</div>
			</div>
		</div>
	);
}
