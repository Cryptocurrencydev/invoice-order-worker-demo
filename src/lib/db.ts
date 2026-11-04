import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __iowPool: Pool | undefined;
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1|\/tmp|@\/|host=\//.test(url) || url.startsWith("postgres:///") || !url.includes(".");
  return new Pool({ connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
}

export function pool() {
  globalThis.__iowPool ??= makePool();
  return globalThis.__iowPool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const r = await pool().query<T>(text, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
