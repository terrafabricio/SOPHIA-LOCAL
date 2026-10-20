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
  redactAuditStatement,
  updateStatement,
  withIdempotency,
} from "../storage/write";
import {
  dateOnlySchema,
  exists,
  idempotencyKeySchema,
  normalizeForComparison,
  optionalText,
  parseInput,
  prioritySchema,
  requiredText,
  type Priority,
} from "./common";
import { touchProjectStatement } from "./projects";

export const TASK_STATUSES = [
  "inbox",
  "clarify",
  "next",
  "scheduled",
  "in_progress",
  "waiting",
  "blocked",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ["done", "cancelled"];

export interface Task {
  id: string;
  title: string;
  description: string | null;
  projectId: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  startDate: string | null;
  estimateMinutes: number | null;
  completedAt: string | null;
  inboxItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

const editableFields = {
  description: optionalText(20000),
  projectId: z.string().min(1).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: prioritySchema.optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  startDate: dateOnlySchema.nullable().optional(),
  estimateMinutes: z.number().int().positive({ error: "A estimativa deve ser em minutos, maior que zero." }).nullable().optional(),
};

export const createTaskSchema = z.object({
  title: requiredText("O título da tarefa", 300),
  ...editableFields,
  /** Criar mesmo havendo tarefa aberta com o mesmo título (o usuário confirmou). */
  allowDuplicate: z.boolean().optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object({ title: requiredText("O título da tarefa", 300).optional(), ...editableFields }).strict();
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  estimate_minutes: number | null;
  completed_at: string | null;
  inbox_item_id: string | null;
  created_at: string;
  updated_at: string;
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  description: r.description,
  projectId: r.project_id,
  status: r.status,
  priority: r.priority,
  dueDate: r.due_date,
  startDate: r.start_date,
  estimateMinutes: r.estimate_minutes,
  completedAt: r.completed_at,
  inboxItemId: r.inbox_item_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const columnOf: Record<string, string> = {
  title: "title",
  description: "description",
  projectId: "project_id",
  status: "status",
  priority: "priority",
  dueDate: "due_date",
  startDate: "start_date",
  estimateMinutes: "estimate_minutes",
};

export async function getTask(ctx: CoreContext, id: string): Promise<Task | null> {
  const rows = await ctx.db.select<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
  return rows[0] ? toTask(rows[0]) : null;
}

export interface TaskFilter {
  statuses?: readonly TaskStatus[];
  /** `null` = só tarefas sem projeto. */
  projectId?: string | null;
  /** Por padrão, concluídas e canceladas ficam de fora. */
  includeClosed?: boolean;
}

export async function listTasks(ctx: CoreContext, filter: TaskFilter = {}): Promise<Task[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.statuses?.length) {
    where.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  } else if (!filter.includeClosed) {
    where.push(`status NOT IN (${CLOSED_TASK_STATUSES.map(() => "?").join(", ")})`);
    params.push(...CLOSED_TASK_STATUSES);
  }
  if (filter.projectId !== undefined) {
    where.push("project_id IS ?");
    params.push(filter.projectId);
  }
  const rows = await ctx.db.select<TaskRow>(
    `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY due_date IS NULL, due_date, created_at`,
    params,
  );
  return rows.map(toTask);
}

async function findOpenDuplicate(ctx: CoreContext, title: string, projectId: string | null): Promise<Task | null> {
  const target = normalizeForComparison(title);
  const candidates = await listTasks(ctx, { projectId });
  return candidates.find((t) => normalizeForComparison(t.title) === target) ?? null;
}

/** Prepara a criação sem executar. Usado também na conversão de itens da Inbox. */
export async function prepareCreateTask(
  ctx: CoreContext,
  input: CreateTaskInput,
  extra: { inboxItemId?: string } = {},
): Promise<Result<{ id: string; statements: Statement[] }>> {
  const parsed = parseInput(createTaskSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const projectId = v.projectId ?? null;

  if (projectId && !(await exists(ctx, "projects", projectId))) {
    return fail("not_found", "Projeto não encontrado.", { projectId });
  }
  if (!v.allowDuplicate) {
    const duplicate = await findOpenDuplicate(ctx, v.title, projectId);
    if (duplicate) {
      return fail("possible_duplicate", `Já existe uma tarefa aberta chamada "${duplicate.title}".`, {
        existingId: duplicate.id,
      });
    }
  }

  const id = ctx.newId();
  const now = nowIso(ctx);
  const status = v.status ?? "next";
  const row = {
    id,
    title: v.title,
    description: v.description ?? null,
    project_id: projectId,
    status,
    priority: v.priority ?? "normal",
    due_date: v.dueDate ?? null,
    start_date: v.startDate ?? null,
    estimate_minutes: v.estimateMinutes ?? null,
    completed_at: status === "done" ? now : null,
    inbox_item_id: extra.inboxItemId ?? null,
    created_at: now,
    updated_at: now,
  } satisfies TaskRow;

  const statements = [insertStatement("tasks", row), auditStatement(ctx, "task.created", "task", id, { after: row })];
  if (projectId) statements.push(touchProjectStatement(ctx, projectId));
  if (v.idempotencyKey) statements.push(operationStatement(ctx, v.idempotencyKey, "task.create", "task", id));
  return ok({ id, statements });
}

export async function createTask(ctx: CoreContext, input: CreateTaskInput): Promise<Result<Task>> {
  return withIdempotency(ctx, input.idempotencyKey, "task.create", (id) => getTask(ctx, id), async () => {
    const prepared = await prepareCreateTask(ctx, input);
    if (!prepared.ok) return prepared;
    const saved = await commit(ctx, prepared.value.statements);
    if (!saved.ok) return saved;
    return loadOrFail(ctx, prepared.value.id);
  });
}

export async function updateTask(ctx: CoreContext, id: string, patch: UpdateTaskInput): Promise<Result<Task>> {
  const parsed = parseInput(updateTaskSchema, patch);
  if (!parsed.ok) return parsed;
  const current = await getTask(ctx, id);
  if (!current) return fail("not_found", "Tarefa não encontrada.", { id });
  const nextProjectId = parsed.value.projectId;
  if (nextProjectId && !(await exists(ctx, "projects", nextProjectId))) {
    return fail("not_found", "Projeto não encontrado.", { projectId: nextProjectId });
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, SqlValue> = {};
  for (const [field, value] of Object.entries(parsed.value)) {
    if (value === undefined) continue;
    const prev = current[field as keyof Task];
    if (prev === value) continue;
    before[field] = prev;
    after[field] = value as SqlValue;
  }
  if (Object.keys(after).length === 0) return ok(current);

  const now = nowIso(ctx);
  const changes: Record<string, SqlValue> = { updated_at: now };
  for (const [field, value] of Object.entries(after)) changes[columnOf[field] as string] = value;

  // Regra única para a data de conclusão: entrar em "done" marca, sair de "done" limpa.
  if (after.status !== undefined) {
    if (after.status === "done") changes.completed_at = now;
    else if (current.status === "done") changes.completed_at = null;
  }

  const action = after.status === "done" ? "task.completed" : "task.updated";
  const statements: Statement[] = [
    updateStatement("tasks", id, changes),
    auditStatement(ctx, action, "task", id, { before, after }),
  ];
  for (const projectId of new Set([current.projectId, nextProjectId ?? current.projectId])) {
    if (projectId) statements.push(touchProjectStatement(ctx, projectId));
  }

  const saved = await commit(ctx, statements);
  if (!saved.ok) return saved;
  return loadOrFail(ctx, id);
}

/** Concluir duas vezes não é erro: a segunda chamada só devolve a tarefa já concluída. */
export async function completeTask(ctx: CoreContext, id: string): Promise<Result<Task>> {
  const current = await getTask(ctx, id);
  if (!current) return fail("not_found", "Tarefa não encontrada.", { id });
  if (current.status === "done") return ok(current, true);
  return updateTask(ctx, id, { status: "done" });
}

/**
 * Exclui a tarefa e seus lembretes. O conteúdo do histórico é apagado.
 * A captura de origem na Inbox, se houver, não é afetada: excluí-la é outra ação.
 */
export async function deleteTask(ctx: CoreContext, id: string): Promise<Result<{ id: string }>> {
  const current = await getTask(ctx, id);
  if (!current) return fail("not_found", "Tarefa não encontrada.", { id });
  const reminders = await ctx.db.select<{ id: string }>("SELECT id FROM reminders WHERE task_id = ?", [id]);

  const statements: Statement[] = [
    { sql: "DELETE FROM tasks WHERE id = ?", params: [id] },
    redactAuditStatement("task", id),
    auditStatement(ctx, "task.deleted", "task", id),
  ];
  for (const r of reminders) {
    statements.push(redactAuditStatement("reminder", r.id), auditStatement(ctx, "reminder.deleted", "reminder", r.id));
  }
  if (current.projectId) statements.push(touchProjectStatement(ctx, current.projectId));

  const saved = await commit(ctx, statements);
  return saved.ok ? ok({ id }) : saved;
}

export const taskHistory = (ctx: CoreContext, id: string) => readHistory(ctx, "task", id);

async function loadOrFail(ctx: CoreContext, id: string): Promise<Result<Task>> {
  const task = await getTask(ctx, id);
  return task ? ok(task) : fail("storage_error", "A tarefa foi salva, mas não pôde ser relida.", { id });
}
