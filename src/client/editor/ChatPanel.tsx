/** Board chat panel: server-ordered history plus a composer for edit capabilities. */
import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../shared/protocol';

function formatTime(value: number): string {
	return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface ChatPanelProps {
	messages: ChatMessage[];
	participantId: string;
	canPost: boolean;
	onSend: (body: string) => boolean;
	onClose: () => void;
}

export function ChatPanel({ messages, participantId, canPost, onSend, onClose }: ChatPanelProps) {
	const [draft, setDraft] = useState('');
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Keep the newest message in view as history grows.
	useEffect(() => {
		const list = listRef.current;
		if (list) list.scrollTop = list.scrollHeight;
	}, [messages]);

	function submit() {
		if (onSend(draft)) setDraft('');
	}

	return (
		<aside className="chat-panel" aria-label="Board chat">
			<div className="chat-heading">
				<strong>Chat</strong>
				<button className="icon-button" onClick={onClose} aria-label="Close chat">
					<X size={16} />
				</button>
			</div>

			<div className="chat-log" ref={listRef} role="log" aria-live="polite" aria-label="Chat messages">
				{messages.length === 0 ? (
					<p className="chat-empty">
						No messages yet. {canPost ? 'Say hello to everyone on this board.' : 'Messages from editors will appear here.'}
					</p>
				) : (
					messages.map((message) => (
						<article key={message.id} className={message.participantId === participantId ? 'chat-message own' : 'chat-message'}>
							<header>
								<span className="chat-author" style={{ color: message.color }}>
									{message.displayName}
								</span>
								<time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
							</header>
							<p>{message.body}</p>
						</article>
					))
				)}
			</div>

			{canPost ? (
				<form
					className="chat-composer"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<textarea
						ref={inputRef}
						value={draft}
						maxLength={500}
						rows={2}
						placeholder="Message the board..."
						aria-label="Chat message"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault();
								submit();
							}
						}}
					/>
					<button className="button small primary" type="submit" disabled={!draft.trim()} aria-label="Send message">
						<Send size={15} />
					</button>
				</form>
			) : (
				<p className="chat-readonly">This link is view-only, so you can read the conversation but not reply.</p>
			)}
		</aside>
	);
}
