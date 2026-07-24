/** Browser entrypoint that resolves landing and capability-link board routes. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WhiteboardPage } from './editor/WhiteboardPage';
import { LandingPage } from './landing/LandingPage';
import './styles/app.css';

function App() {
	const match = window.location.pathname.match(/^\/board\/([A-Za-z0-9_-]{20,30})\/?$/);
	if (!match) return <LandingPage />;
	const hash = new URLSearchParams(window.location.hash.slice(1));
	const token = hash.get('edit') ?? hash.get('view') ?? '';
	if (!token)
		return (
			<main className="invalid-board">
				<h1>This share link is incomplete.</h1>
				<a className="button primary" href="/">
					Return home
				</a>
			</main>
		);
	return <WhiteboardPage boardId={match[1]} token={token} />;
}

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
