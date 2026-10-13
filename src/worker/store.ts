import { DurableObject } from "cloudflare:workers";
import type { ChatMessage, DoorResult } from "../shared/result";

export type Env = {
  STORE: DurableObjectNamespace<DoorStore>;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  /** Most the AI may cost this door in one day, in US dollars. */
  DAILY_LIMIT_USD?: string;
  /** "stand-in" = the free labelled writer, for tests only. */
  WRITER?: string;
  /** Assessments one visitor may start per hour (default 5). */
  ASSESS_PER_HOUR?: string;
};

const today = () => new Date().toISOString().slice(0, 10);

/** One store per door (a single named instance): saved results, advisor
 *  conversations, the visit limits and the day's AI spending. Everything stays
 *  in the client's own Cloudflare account. */
export class DoorStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, body TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS spend (booking TEXT PRIMARY KEY, day TEXT NOT NULL, usd REAL NOT NULL, settled INTEGER NOT NULL DEFAULT 0, what TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, at INTEGER NOT NULL)`);
  }

  /** Counts this visit against the limit; false = over it. */
  hit(key: string, limit: number, windowSec: number): boolean {
    const now = Date.now();
    this.sql.exec(`DELETE FROM hits WHERE at < ?`, now - 24 * 3600 * 1000);
    const n = this.sql.exec(`SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at >= ?`, key, now - windowSec * 1000).one().n as number;
    if (n >= limit) return false;
    this.sql.exec(`INSERT INTO hits (key, at) VALUES (?, ?)`, key, now);
    return true;
  }

  spentToday(): number {
    return (this.sql.exec(`SELECT COALESCE(SUM(usd), 0) AS s FROM spend WHERE day = ?`, today()).one().s as number) ?? 0;
  }

  /** Books the worst case BEFORE anything is spent. Refuses if the booking
   *  would pass the day's limit. A booking never settled stays counted. */
  book(usd: number, limitUsd: number, what: string): { ok: true; booking: string } | { ok: false; spent: number } {
    const spent = this.spentToday();
    if (!(usd > 0) || spent + usd > limitUsd) return { ok: false, spent };
    const booking = crypto.randomUUID();
    this.sql.exec(`INSERT INTO spend (booking, day, usd, what) VALUES (?, ?, ?, ?)`, booking, today(), usd, what);
    return { ok: true, booking };
  }

  /** Brings a booking down to the measured cost. Never raises it above what
   *  was booked unless the measurement says so. */
  settle(booking: string, usd: number): void {
    this.sql.exec(`UPDATE spend SET usd = ?, settled = 1 WHERE booking = ?`, Math.max(0, usd), booking);
  }

  saveResult(r: DoorResult): void {
    this.sql.exec(`INSERT INTO results (id, body, created_at) VALUES (?, ?, ?)`, r.id, JSON.stringify(r), r.createdAt);
  }

  getResult(id: string): DoorResult | null {
    const rows = this.sql.exec(`SELECT body FROM results WHERE id = ?`, id).toArray();
    return rows.length ? (JSON.parse(rows[0].body as string) as DoorResult) : null;
  }

  getChat(id: string): ChatMessage[] {
    const rows = this.sql.exec(`SELECT body FROM chats WHERE id = ?`, id).toArray();
    return rows.length ? (JSON.parse(rows[0].body as string) as ChatMessage[]) : [];
  }

  appendChat(id: string, add: ChatMessage[]): ChatMessage[] {
    const all = this.getChat(id).concat(add).slice(-60);
    this.sql.exec(`INSERT INTO chats (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body`, id, JSON.stringify(all));
    return all;
  }
}
