import { createContext, type Clock, type CoreContext } from "../../src/context";
import type { Result } from "../../src/result";
import { migrate } from "../../src/storage/migrate";
import { openNodeSqlite, type NodeSqliteDriver } from "./node-sqlite-driver";

export interface TestClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function testClock(startIso = "2026-10-20T12:00:00.000Z"): TestClock {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    set: (iso) => {
      t = new Date(iso).getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

export interface TestCore {
  ctx: CoreContext;
  db: NodeSqliteDriver;
  clock: TestClock;
}

export async function makeCore(path = ":memory:", clock: TestClock = testClock()): Promise<TestCore> {
  const db = openNodeSqlite(path);
  await migrate(db);
  let seq = 0;
  const ctx = createContext(db, { clock, newId: () => `id-${String(++seq).padStart(4, "0")}` });
  return { ctx, db, clock };
}

/** Extrai o valor de um resultado de sucesso; falha o teste com a mensagem real se não for. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Esperava sucesso, veio ${result.error.code}: ${result.error.message}`);
  return result.value;
}

export function expectError<T>(result: Result<T>, code: string): { message: string; details?: unknown } {
  if (result.ok) throw new Error(`Esperava erro ${code}, veio sucesso.`);
  if (result.error.code !== code) {
    throw new Error(`Esperava erro ${code}, veio ${result.error.code}: ${result.error.message}`);
  }
  return result.error;
}

export async function count(core: TestCore, table: string): Promise<number> {
  const rows = await core.db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}
