import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type JobStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "settling"
  | "confirming"
  | "confirmed"
  | "failed";

export type Job = {
  id: string;
  externalKey?: string;
  type: string;
  status: JobStatus;
  account: string;
  actionId?: string | undefined;
  txHash?: string | undefined;
  error?: string | undefined;
  payload: unknown;
  response?: unknown | undefined;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS challenges (
        address TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        external_key TEXT UNIQUE,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        account TEXT NOT NULL,
        action_id TEXT,
        tx_hash TEXT,
        error TEXT,
        payload TEXT NOT NULL,
        response TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cursors (
        name TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_account_created_idx
        ON jobs(account, created_at DESC);
      CREATE INDEX IF NOT EXISTS jobs_status_updated_idx
        ON jobs(status, updated_at);
    `);
    this.ensureColumn("jobs", "external_key", "TEXT");
    this.ensureColumn("jobs", "response", "TEXT");
    this.ensureColumn("jobs", "attempts", "INTEGER NOT NULL DEFAULT 0");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS jobs_external_key_idx ON jobs(external_key)");
  }

  close() {
    this.db.close();
  }

  putChallenge(address: string, nonce: string, expiresAt: number) {
    this.db
      .prepare(
        `INSERT INTO challenges(address, nonce, expires_at)
         VALUES(?, ?, ?)
         ON CONFLICT(address) DO UPDATE
         SET nonce=excluded.nonce, expires_at=excluded.expires_at`,
      )
      .run(address.toLowerCase(), nonce, expiresAt);
  }

  consumeChallenge(address: string, nonce: string, now: number) {
    const row = this.db
      .prepare("SELECT nonce, expires_at FROM challenges WHERE address=?")
      .get(address.toLowerCase()) as { nonce: string; expires_at: number } | undefined;
    if (!row || row.nonce !== nonce || row.expires_at < now) return false;
    this.db.prepare("DELETE FROM challenges WHERE address=?").run(address.toLowerCase());
    return true;
  }

  createJob(type: string, account: string, payload: unknown, externalKey?: string): Job {
    if (externalKey) {
      const existing = this.getJobByExternalKey(externalKey);
      if (existing) return existing;
    }
    const now = Date.now();
    const job: Job = {
      id: randomUUID(),
      ...(externalKey ? { externalKey } : {}),
      type,
      status: "queued",
      account: account.toLowerCase(),
      payload,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO jobs(
          id, external_key, type, status, account, payload, attempts, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.externalKey ?? null,
        job.type,
        job.status,
        job.account,
        JSON.stringify(payload),
        job.attempts,
        now,
        now,
      );
    return job;
  }

  updateJob(
    id: string,
    patch: Partial<
      Pick<Job, "status" | "actionId" | "txHash" | "error" | "response" | "attempts">
    >,
  ) {
    const current = this.getJob(id);
    if (!current) throw new Error("job not found");
    const next: Job = { ...current, ...patch, updatedAt: Date.now() };
    this.db
      .prepare(
        `UPDATE jobs
         SET status=?, action_id=?, tx_hash=?, error=?, response=?, attempts=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        next.status,
        next.actionId ?? null,
        next.txHash ?? null,
        next.error ?? null,
        next.response === undefined ? null : JSON.stringify(next.response),
        next.attempts,
        next.updatedAt,
        id,
      );
    return next;
  }

  getJob(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? fromRow(row) : undefined;
  }

  getJobByExternalKey(externalKey: string): Job | undefined {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE external_key=?")
      .get(externalKey) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : undefined;
  }

  listJobs(account: string, limit = 50): Job[] {
    return (
      this.db
        .prepare("SELECT * FROM jobs WHERE account=? ORDER BY created_at DESC LIMIT ?")
        .all(account.toLowerCase(), limit) as Record<string, unknown>[]
    ).map(fromRow);
  }

  nextRunnableJob(): Job | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE status IN ('queued', 'submitted', 'processing', 'settling', 'confirming')
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    return row ? fromRow(row) : undefined;
  }

  resetForRetry(id: string): Job {
    const current = this.getJob(id);
    if (!current) throw new Error("job not found");
    if (current.status !== "failed") throw new Error("only failed jobs can be retried");
    return this.updateJob(id, {
      status: current.actionId ? "submitted" : "queued",
      error: undefined,
    });
  }

  getCursor(name: string, fallback: bigint) {
    const row = this.db.prepare("SELECT value FROM cursors WHERE name=?").get(name) as
      | { value: string }
      | undefined;
    return row ? BigInt(row.value) : fallback;
  }

  setCursor(name: string, value: bigint) {
    this.db
      .prepare(
        `INSERT INTO cursors(name, value) VALUES(?, ?)
         ON CONFLICT(name) DO UPDATE SET value=excluded.value`,
      )
      .run(name, value.toString());
  }

  private ensureColumn(table: string, column: string, declaration: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
    }
  }
}

function fromRow(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    ...(row.external_key ? { externalKey: String(row.external_key) } : {}),
    type: String(row.type),
    status: String(row.status) as JobStatus,
    account: String(row.account),
    ...(row.action_id ? { actionId: String(row.action_id) } : {}),
    ...(row.tx_hash ? { txHash: String(row.tx_hash) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    payload: JSON.parse(String(row.payload)) as unknown,
    ...(row.response ? { response: JSON.parse(String(row.response)) as unknown } : {}),
    attempts: Number(row.attempts ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
