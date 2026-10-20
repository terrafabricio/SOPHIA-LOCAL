import type { CoreContext } from "../context";
import { nowIso } from "../context";
import { fail, ok, type Result } from "../result";
import type { SqlValue, Statement } from "./driver";

export type EntityType = "inbox_item" | "task" | "project" | "decision" | "note" | "reminder";

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entityType: EntityType;
  entityId: string;
  data: unknown;
  redacted: boolean;
}

export function auditStatement(
  ctx: CoreContext,
  action: string,
  entityType: EntityType,
  entityId: string,
  data: unknown = null,
): Statement {
  return {
    sql: "INSERT INTO audit_log (at, action, entity_type, entity_id, data) VALUES (?, ?, ?, ?, ?)",
    params: [nowIso(ctx), action, entityType, entityId, data === null ? null : JSON.stringify(data)],
  };
}

/**
 * Ao excluir um registro, o histórico mantém a trilha (o quê e quando), mas
 * o conteúdo das entradas anteriores é apagado. Excluir é excluir de verdade.
 */
export function redactAuditStatement(entityType: EntityType, entityId: string): Statement {
  return {
    sql: "UPDATE audit_log SET data = NULL, redacted = 1 WHERE entity_type = ? AND entity_id = ?",
    params: [entityType, entityId],
  };
}

export async function readHistory(ctx: CoreContext, entityType: EntityType, entityId: string): Promise<AuditEntry[]> {
  const rows = await ctx.db.select<{
    id: number;
    at: string;
    action: string;
    entity_type: EntityType;
    entity_id: string;
    data: string | null;
    redacted: number;
  }>("SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id", [entityType, entityId]);
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    data: r.data === null ? null : JSON.parse(r.data),
    redacted: r.redacted === 1,
  }));
}

export function insertStatement(table: string, row: Record<string, SqlValue>): Statement {
  const cols = Object.keys(row);
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    params: cols.map((c) => row[c] ?? null),
  };
}

export function updateStatement(table: string, id: string, changes: Record<string, SqlValue>): Statement {
  const cols = Object.keys(changes);
  return {
    sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    params: [...cols.map((c) => changes[c] ?? null), id],
  };
}

/** Executa um lote atômico. Falha de armazenamento vira resultado explícito, nunca sucesso presumido. */
export async function commit(ctx: CoreContext, statements: readonly Statement[]): Promise<Result<void>> {
  try {
    await ctx.db.batch(statements);
    return ok(undefined);
  } catch (err) {
    return fail("storage_error", "Não foi possível salvar. Nada foi alterado.", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Idempotência
// ---------------------------------------------------------------------------

export function operationStatement(
  ctx: CoreContext,
  key: string,
  operation: string,
  entityType: EntityType,
  entityId: string,
): Statement {
  return {
    sql: "INSERT INTO operations (idempotency_key, operation, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)",
    params: [key, operation, entityType, entityId, nowIso(ctx)],
  };
}

async function findOperation(ctx: CoreContext, key: string, operation: string): Promise<string | null> {
  const rows = await ctx.db.select<{ entity_id: string }>(
    "SELECT entity_id FROM operations WHERE idempotency_key = ? AND operation = ?",
    [key, operation],
  );
  return rows[0]?.entity_id ?? null;
}

/**
 * Envolve uma operação de criação com chave de idempotência.
 *
 * - Chave já usada → devolve o item criado da primeira vez, com `duplicate: true`.
 * - Duas execuções simultâneas → a segunda falha na chave única e cai no caso acima.
 *
 * `run` deve incluir `operationStatement(...)` no mesmo lote da criação.
 */
export async function withIdempotency<T>(
  ctx: CoreContext,
  key: string | undefined,
  operation: string,
  load: (entityId: string) => Promise<T | null>,
  run: () => Promise<Result<T>>,
): Promise<Result<T>> {
  if (key === undefined) return run();

  const replay = async (): Promise<Result<T> | null> => {
    const entityId = await findOperation(ctx, key, operation);
    if (entityId === null) return null;
    const value = await load(entityId);
    return value === null
      ? fail("not_found", "Esta solicitação já foi executada, mas o item foi excluído depois.", { entityId })
      : ok(value, true);
  };

  const previous = await replay();
  if (previous) return previous;

  const result = await run();
  if (!result.ok && result.error.code === "storage_error") {
    const raced = await replay();
    if (raced) return raced;
  }
  return result;
}
