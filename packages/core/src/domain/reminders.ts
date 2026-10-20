import { z } from "zod";
import { nowIso, type CoreContext } from "../context";
import { fail, ok, type Result } from "../result";
import type { SqlValue, Statement } from "../storage/driver";
import {
  auditStatement,
  commit,
  insertStatement,
  operationStatement,
  readHistory,
  updateStatement,
  withIdempotency,
} from "../storage/write";
import { exists, idempotencyKeySchema, instantSchema, parseInput, requiredText } from "./common";

/**
 * Estados do lembrete. Cada um afirma só o que o sistema sabe de fato:
 *
 * - pending    criado e salvo; o agendador ainda não o assumiu.
 * - scheduled  o agendador assumiu e vai disparar no horário.
 * - fired      a notificação foi entregue ao macOS (não quer dizer que foi vista).
 * - seen       o macOS ou o usuário confirmou que foi vista.
 * - cancelled  cancelado pelo usuário.
 * - failed     o disparo falhou; precisa de atenção.
 *
 * Nesta etapa, o núcleo só cria, reagenda e cancela. Disparo, recuperação
 * após reinício e anti-duplicata ficam no agendador (etapa 4).
 */
export const REMINDER_STATUSES = ["pending", "scheduled", "fired", "seen", "cancelled", "failed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export interface Reminder {
  id: string;
  title: string;
  taskId: string | null;
  /** Instante em UTC (ISO 8601). */
  dueAt: string;
  /** Fuso IANA de referência, por exemplo "America/Sao_Paulo". */
  timezone: string;
  status: ReminderStatus;
  firedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z.string().refine(isValidTimeZone, { error: "Fuso horário desconhecido." });

export const createReminderSchema = z.object({
  title: requiredText("O texto do lembrete", 300),
  dueAt: instantSchema,
  timezone: timezoneSchema,
  taskId: z.string().min(1).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type CreateReminderInput = z.input<typeof createReminderSchema>;

interface ReminderRow {
  id: string;
  title: string;
  task_id: string | null;
  due_at: string;
  timezone: string;
  status: ReminderStatus;
  fired_at: string | null;
  created_at: string;
  updated_at: string;
}

const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  title: r.title,
  taskId: r.task_id,
  dueAt: r.due_at,
  timezone: r.timezone,
  status: r.status,
  firedAt: r.fired_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getReminder(ctx: CoreContext, id: string): Promise<Reminder | null> {
  const rows = await ctx.db.select<ReminderRow>("SELECT * FROM reminders WHERE id = ?", [id]);
  return rows[0] ? toReminder(rows[0]) : null;
}

export async function listReminders(
  ctx: CoreContext,
  filter: { statuses?: readonly ReminderStatus[]; taskId?: string } = {},
): Promise<Reminder[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.statuses?.length) {
    where.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  }
  if (filter.taskId !== undefined) {
    where.push("task_id = ?");
    params.push(filter.taskId);
  }
  const rows = await ctx.db.select<ReminderRow>(
    `SELECT * FROM reminders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY due_at`,
    params,
  );
  return rows.map(toReminder);
}

/**
 * Prepara a criação sem executar. `taskCreatedInSameBatch` permite ligar o
 * lembrete a uma tarefa que nasce no mesmo lote (conversão da Inbox).
 */
export async function prepareCreateReminder(
  ctx: CoreContext,
  input: CreateReminderInput,
  extra: { taskCreatedInSameBatch?: boolean } = {},
): Promise<Result<{ id: string; statements: Statement[] }>> {
  const parsed = parseInput(createReminderSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const taskId = v.taskId ?? null;
  if (taskId && !extra.taskCreatedInSameBatch && !(await exists(ctx, "tasks", taskId))) {
    return fail("not_found", "Tarefa não encontrada.", { taskId });
  }
  const id = ctx.newId();
  const now = nowIso(ctx);
  const row = {
    id,
    title: v.title,
    task_id: taskId,
    due_at: new Date(v.dueAt).toISOString(),
    timezone: v.timezone,
    status: "pending",
    fired_at: null,
    created_at: now,
    updated_at: now,
  } satisfies ReminderRow;
  const statements = [insertStatement("reminders", row), auditStatement(ctx, "reminder.created", "reminder", id, { after: row })];
  if (v.idempotencyKey) statements.push(operationStatement(ctx, v.idempotencyKey, "reminder.create", "reminder", id));
  return ok({ id, statements });
}

export async function createReminder(ctx: CoreContext, input: CreateReminderInput): Promise<Result<Reminder>> {
  return withIdempotency(ctx, input.idempotencyKey, "reminder.create", (id) => getReminder(ctx, id), async () => {
    const prepared = await prepareCreateReminder(ctx, input);
    if (!prepared.ok) return prepared;
    const saved = await commit(ctx, prepared.value.statements);
    if (!saved.ok) return saved;
    return loadOrFail(ctx, prepared.value.id);
  });
}

const rescheduleSchema = z.object({ dueAt: instantSchema, timezone: timezoneSchema.optional() });

/** Reagendar devolve o lembrete a "pending" para o agendador assumir o novo horário. */
export async function rescheduleReminder(
  ctx: CoreContext,
  id: string,
  input: z.input<typeof rescheduleSchema>,
): Promise<Result<Reminder>> {
  const parsed = parseInput(rescheduleSchema, input);
  if (!parsed.ok) return parsed;
  const current = await getReminder(ctx, id);
  if (!current) return fail("not_found", "Lembrete não encontrado.", { id });
  if (current.status === "cancelled") {
    return fail("invalid_state", "Lembrete cancelado. Crie um novo em vez de reagendar.", { id });
  }
  const dueAt = new Date(parsed.value.dueAt).toISOString();
  const timezone = parsed.value.timezone ?? current.timezone;
  const saved = await commit(ctx, [
    updateStatement("reminders", id, { due_at: dueAt, timezone, status: "pending", fired_at: null, updated_at: nowIso(ctx) }),
    auditStatement(ctx, "reminder.rescheduled", "reminder", id, {
      before: { dueAt: current.dueAt, timezone: current.timezone, status: current.status },
      after: { dueAt, timezone, status: "pending" },
    }),
  ]);
  if (!saved.ok) return saved;
  return loadOrFail(ctx, id);
}

/** Cancelar duas vezes não é erro. Um lembrete já disparado ou visto não pode mais ser cancelado. */
export async function cancelReminder(ctx: CoreContext, id: string): Promise<Result<Reminder>> {
  const current = await getReminder(ctx, id);
  if (!current) return fail("not_found", "Lembrete não encontrado.", { id });
  if (current.status === "cancelled") return ok(current, true);
  if (current.status === "fired" || current.status === "seen") {
    return fail("invalid_state", "Este lembrete já foi disparado.", { status: current.status });
  }
  const saved = await commit(ctx, [
    updateStatement("reminders", id, { status: "cancelled", updated_at: nowIso(ctx) }),
    auditStatement(ctx, "reminder.cancelled", "reminder", id, { before: { status: current.status } }),
  ]);
  if (!saved.ok) return saved;
  return loadOrFail(ctx, id);
}

export const reminderHistory = (ctx: CoreContext, id: string) => readHistory(ctx, "reminder", id);

async function loadOrFail(ctx: CoreContext, id: string): Promise<Result<Reminder>> {
  const reminder = await getReminder(ctx, id);
  return reminder ? ok(reminder) : fail("storage_error", "O lembrete foi salvo, mas não pôde ser relido.", { id });
}
