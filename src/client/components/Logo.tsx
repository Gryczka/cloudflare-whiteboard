/** Shared Cloudflare Whiteboard wordmark with a compact editor variant. */
export function Logo({ compact = false }: { compact?: boolean }) {
	return (
		<span className="logo">
			<span className="logo-mark" aria-hidden="true">
				<i />
				<i />
				<i />
			</span>
			{!compact && (
				<span>
					Cloudflare <strong>Whiteboard</strong>
				</span>
			)}
		</span>
	);
}
