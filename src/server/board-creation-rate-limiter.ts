/** Per-client board-creation reservations backed by embedded SQLite. */
import { DurableObject } from 'cloudflare:workers';

type WindowRow = Record<string, SqlStorageValue> & {
	window_start: number;
	reservations: number;
	cleanup_at: number;
};

const MAX_RESERVATIONS = 5;
const WINDOW_MS = 60_000;
const CLEANUP_DELAY_MS = 10 * 60_000;

/** Enforces one fixed-window creation limit for a hashed client address. */
export class BoardCreationRateLimiter extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ensureSchema();
	}

	private ensureSchema(): void {
		this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reservation_window (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        window_start INTEGER NOT NULL,
        reservations INTEGER NOT NULL,
        cleanup_at INTEGER NOT NULL
      );
    `);
	}

	async reserve(now = Date.now()): Promise<boolean> {
		this.ensureSchema();
		const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
		const cleanupAt = Date.now() + CLEANUP_DELAY_MS;
		const accepted = this.ctx.storage.transactionSync(() => {
			const current = this.ctx.storage.sql
				.exec<WindowRow>('SELECT window_start, reservations, cleanup_at FROM reservation_window WHERE singleton = 1')
				.toArray()[0];

			if (!current || current.window_start !== windowStart) {
				this.ctx.storage.sql.exec(
					`INSERT INTO reservation_window (singleton, window_start, reservations, cleanup_at)
						 VALUES (1, ?, 1, ?)
						 ON CONFLICT (singleton) DO UPDATE SET
						   window_start = excluded.window_start,
						   reservations = 1,
						   cleanup_at = excluded.cleanup_at`,
					windowStart,
					cleanupAt,
				);
				return true;
			}

			if (current.reservations >= MAX_RESERVATIONS) return false;
			this.ctx.storage.sql.exec(
				'UPDATE reservation_window SET reservations = reservations + 1, cleanup_at = ? WHERE singleton = 1',
				cleanupAt,
			);
			return true;
		});

		if (accepted) await this.ctx.storage.setAlarm(cleanupAt);
		return accepted;
	}

	async alarm(): Promise<void> {
		this.ensureSchema();
		const current = this.ctx.storage.sql.exec<WindowRow>('SELECT cleanup_at FROM reservation_window WHERE singleton = 1').toArray()[0];
		if (current && current.cleanup_at > Date.now()) {
			await this.ctx.storage.setAlarm(current.cleanup_at);
			return;
		}
		await this.ctx.storage.deleteAll();
	}
}
