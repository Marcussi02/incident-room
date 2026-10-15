import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Return timestamptz columns as ISO strings so API responses are stable JSON.
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  const needsSsl = /sslmode=require/.test(connectionString);
  return new pg.Pool({
    connectionString,
    max: 10,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));

async function findMigrationsDir(): Promise<string> {
  // src/db.ts -> ../migrations, dist/src/db.js -> ../../migrations
  for (const candidate of [path.resolve(here, "../migrations"), path.resolve(here, "../../migrations")]) {
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error("migrations directory not found");
}

/** Applies any .sql files in migrations/ that haven't run yet, each in its own transaction. */
export async function migrate(db: Db): Promise<void> {
  const dir = await findMigrationsDir();
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
