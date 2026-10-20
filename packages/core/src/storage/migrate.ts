import type { SqlDriver } from "./driver";
import { migration001 } from "./migrations/001-initial";

export interface Migration {
  version: number;
  name: string;
  /** Uma instrução SQL por item; aplicadas atomicamente junto com o registro da versão. */
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [migration001];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

/**
 * Aplica as migrações pendentes, em ordem, cada uma numa transação.
 * Pode ser chamado em toda inicialização: é idempotente.
 * Retorna as versões aplicadas nesta chamada.
 */
export async function migrate(db: SqlDriver, migrations: readonly Migration[] = MIGRATIONS): Promise<number[]> {
  await db.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
    },
  ]);

  const rows = await db.select<{ version: number }>("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  const newest = Math.max(0, ...applied);
  const known = Math.max(0, ...migrations.map((m) => m.version));
  if (newest > known) {
    throw new Error(
      `Banco na versão ${newest}, mas este app conhece até a ${known}. Atualize o app antes de abrir este banco.`,
    );
  }

  const pending = [...migrations].filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    await db.batch([
      ...m.statements.map((sql) => ({ sql })),
      {
        sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        params: [m.version, m.name, new Date().toISOString()],
      },
    ]);
  }
  return pending.map((m) => m.version);
}

export async function schemaVersion(db: SqlDriver): Promise<number> {
  const rows = await db.select<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
  return rows[0]?.v ?? 0;
}
