import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue, Statement } from "../../src/storage/driver";

export interface NodeSqliteDriver extends SqlDriver {
  close(): void;
  /** Gancho de teste: lançar aqui simula uma falha no meio de um lote (depois de instruções já executadas). */
  beforeStatement?: (index: number, statement: Statement) => void;
}

/** Adaptador de teste sobre `node:sqlite`. O app desktop terá o seu próprio adaptador. */
export function openNodeSqlite(path = ":memory:"): NodeSqliteDriver {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");

  const driver: NodeSqliteDriver = {
    async select<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params).map((row) => ({ ...row })) as T[];
    },
    async batch(statements: readonly Statement[]): Promise<void> {
      db.exec("BEGIN IMMEDIATE");
      try {
        statements.forEach((s, i) => {
          driver.beforeStatement?.(i, s);
          db.prepare(s.sql).run(...(s.params ?? []));
        });
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    close: () => db.close(),
  };
  return driver;
}
