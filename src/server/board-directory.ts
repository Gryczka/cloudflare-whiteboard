import { DurableObject } from 'cloudflare:workers';
import { safeEqual } from '../shared/crypto';

/** One fixed actor, never one actor per caller-supplied board ID. */
export class BoardDirectory extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS boards (
			id TEXT PRIMARY KEY, edit TEXT NOT NULL, view TEXT NOT NULL, expires INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS admission (id INTEGER PRIMARY KEY, hour INTEGER NOT NULL, count INTEGER NOT NULL);`);
	}

	async reserve(id: string, edit: string, view: string, expires: number): Promise<boolean> {
		const now = Date.now();
		const admitted = this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec('DELETE FROM boards WHERE expires <= ?', now);
			if (this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM boards').one().n >= 50) return false;
			const hour = Math.floor(now / 3_600_000);
			const prior = this.ctx.storage.sql
				.exec<{ hour: number; count: number }>('SELECT hour, count FROM admission WHERE id = 1')
				.toArray()[0];
			const count = prior?.hour === hour ? prior.count : 0;
			if (count >= 20 || expires <= now || expires > now + 90 * 86_400_000) return false;
			this.ctx.storage.sql.exec('INSERT INTO boards VALUES (?, ?, ?, ?)', id, edit, view, expires);
			this.ctx.storage.sql.exec('INSERT OR REPLACE INTO admission VALUES (1, ?, ?)', hour, count + 1);
			return true;
		});
		await this.schedule();
		return admitted;
	}

	authorize(id: string, hash: string): boolean {
		const row = this.ctx.storage.sql
			.exec<{ edit: string; view: string; expires: number }>('SELECT edit, view, expires FROM boards WHERE id = ?', id)
			.toArray()[0];
		return Boolean(row && row.expires > Date.now() && (safeEqual(hash, row.edit) || safeEqual(hash, row.view)));
	}

	async alarm(): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM boards WHERE expires <= ?', Date.now());
		await this.schedule();
	}

	private async schedule(): Promise<void> {
		const next = this.ctx.storage.sql.exec<{ deadline: number | null }>('SELECT MIN(expires) AS deadline FROM boards').one().deadline;
		if (next !== null) await this.ctx.storage.setAlarm(next);
		else await this.ctx.storage.deleteAlarm();
	}
}
