/**
 * Resultado explícito das operações do núcleo.
 *
 * Erros de negócio (validação, não encontrado, duplicata) nunca são lançados:
 * voltam como `ok: false` para que a interface sempre saiba o estado real.
 */

export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "possible_duplicate"
  | "invalid_state"
  | "storage_error";

export interface CoreError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type Result<T> =
  | { ok: true; value: T; /** true quando a mesma chave de idempotência já tinha sido executada */ duplicate?: boolean }
  | { ok: false; error: CoreError };

export function ok<T>(value: T, duplicate = false): Result<T> {
  return duplicate ? { ok: true, value, duplicate: true } : { ok: true, value };
}

export function fail<T = never>(code: ErrorCode, message: string, details?: unknown): Result<T> {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } };
}
