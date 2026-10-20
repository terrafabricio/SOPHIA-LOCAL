/**
 * Porta de acesso ao SQLite.
 *
 * O núcleo não conhece a implementação: nos testes usa `node:sqlite`; no app
 * desktop usará um adaptador do Tauri.
 *
 * Escritas acontecem SEMPRE por `batch`, que deve ser atômico (tudo ou nada).
 * Isso evita depender de transações abertas entre chamadas assíncronas, que
 * nem todo adaptador garante (por exemplo, drivers com pool de conexões).
 *
 * Requisito para qualquer adaptador: `PRAGMA foreign_keys = ON` na conexão.
 */

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

export interface SqlDriver {
  select<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Executa todas as instruções numa única transação. Se uma falhar, nenhuma é aplicada. */
  batch(statements: readonly Statement[]): Promise<void>;
}
