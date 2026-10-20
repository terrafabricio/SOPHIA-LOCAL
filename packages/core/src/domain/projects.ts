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
  optionalText,
  parseInput,
  prioritySchema,
  requiredText,
  type Priority,
} from "./common";

/** Uma ideia não vira projeto ativo sozinha: o estado inicial padrão é "idea". */
export const PROJECT_STATUSES = [
  "idea",
  "evaluating",
  "approved",
  "planned",
  "active",
  "paused",
  "blocked",
  "done",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  objective: string | null;
  expectedOutcome: string | null;
  scope: string | null;
  status: ProjectStatus;
  phase: string | null;
  priority: Priority;
  dueDate: string | null;
  nextStep: string | null;
  categoryId: string | null;
  inboxItemId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

const editableFields = {
  objective: optionalText(5000),
  expectedOutcome: optionalText(5000),
  scope: optionalText(5000),
  status: z.enum(PROJECT_STATUSES).optional(),
  phase: optionalText(200),
  priority: prioritySchema.optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  nextStep: optionalText(1000),
  categoryId: z.string().min(1).nullable().optional(),
};

export const createProjectSchema = z.object({
  name: requiredText("O nome do projeto", 200),
  ...editableFields,
  idempotencyKey: idempotencyKeySchema,
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({ name: requiredText("O nome do projeto", 200).optional(), ...editableFields })
  .strict();
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

interface ProjectRow {
  id: string;
  name: string;
  objective: string | null;
  expected_outcome: string | null;
  scope: string | null;
  status: ProjectStatus;
  phase: string | null;
  priority: Priority;
  due_date: string | null;
  next_step: string | null;
  category_id: string | null;
  inbox_item_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  objective: r.objective,
  expectedOutcome: r.expected_outcome,
  scope: r.scope,
  status: r.status,
  phase: r.phase,
  priority: r.priority,
  dueDate: r.due_date,
  nextStep: r.next_step,
  categoryId: r.category_id,
  inboxItemId: r.inbox_item_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastActivityAt: r.last_activity_at,
});

const columnOf: Record<string, string> = {
  name: "name",
  objective: "objective",
  expectedOutcome: "expected_outcome",
  scope: "scope",
  status: "status",
  phase: "phase",
  priority: "priority",
  dueDate: "due_date",
  nextStep: "next_step",
  categoryId: "category_id",
};

export async function getProject(ctx: CoreContext, id: string): Promise<Project | null> {
  const rows = await ctx.db.select<ProjectRow>("SELECT * FROM projects WHERE id = ?", [id]);
  return rows[0] ? toProject(rows[0]) : null;
}

export async function listProjects(
  ctx: CoreContext,
  filter: { statuses?: readonly ProjectStatus[] } = {},
): Promise<Project[]> {
  const statuses = filter.statuses ?? [];
  const where = statuses.length ? `WHERE status IN (${statuses.map(() => "?").join(", ")})` : "";
  const rows = await ctx.db.select<ProjectRow>(
    `SELECT * FROM projects ${where} ORDER BY last_activity_at DESC`,
    statuses,
  );
  return rows.map(toProject);
}

/** Prepara a criação sem executar. Usado também na conversão de itens da Inbox. */
export async function prepareCreateProject(
  ctx: CoreContext,
  input: CreateProjectInput,
  extra: { inboxItemId?: string } = {},
): Promise<Result<{ id: string; statements: Statement[] }>> {
  const parsed = parseInput(createProjectSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.categoryId && !(await exists(ctx, "categories", v.categoryId))) {
    return fail("not_found", "Categoria não encontrada.", { categoryId: v.categoryId });
  }

  const id = ctx.newId();
  const now = nowIso(ctx);
  const row = {
    id,
    name: v.name,
    objective: v.objective ?? null,
    expected_outcome: v.expectedOutcome ?? null,
    scope: v.scope ?? null,
    status: v.status ?? "idea",
    phase: v.phase ?? null,
    priority: v.priority ?? "normal",
    due_date: v.dueDate ?? null,
    next_step: v.nextStep ?? null,
    category_id: v.categoryId ?? null,
    inbox_item_id: extra.inboxItemId ?? null,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  } satisfies ProjectRow;

  const statements = [insertStatement("projects", row), auditStatement(ctx, "project.created", "project", id, { after: row })];
  if (v.idempotencyKey) statements.push(operationStatement(ctx, v.idempotencyKey, "project.create", "project", id));
  return ok({ id, statements });
}

export async function createProject(ctx: CoreContext, input: CreateProjectInput): Promise<Result<Project>> {
  return withIdempotency(ctx, input.idempotencyKey, "project.create", (id) => getProject(ctx, id), async () => {
    const prepared = await prepareCreateProject(ctx, input);
    if (!prepared.ok) return prepared;
    const saved = await commit(ctx, prepared.value.statements);
    if (!saved.ok) return saved;
    return loadOrFail(ctx, prepared.value.id);
  });
}

export async function updateProject(ctx: CoreContext, id: string, patch: UpdateProjectInput): Promise<Result<Project>> {
  const parsed = parseInput(updateProjectSchema, patch);
  if (!parsed.ok) return parsed;
  const current = await getProject(ctx, id);
  if (!current) return fail("not_found", "Projeto não encontrado.", { id });
  if (parsed.value.categoryId && !(await exists(ctx, "categories", parsed.value.categoryId))) {
    return fail("not_found", "Categoria não encontrada.", { categoryId: parsed.value.categoryId });
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, SqlValue> = {};
  for (const [field, value] of Object.entries(parsed.value)) {
    if (value === undefined) continue;
    const next = value as SqlValue;
    const prev = current[field as keyof Project];
    if (prev === next) continue;
    before[field] = prev;
    after[field] = next;
  }
  if (Object.keys(after).length === 0) return ok(current);

  const now = nowIso(ctx);
  const changes: Record<string, SqlValue> = { updated_at: now, last_activity_at: now };
  for (const [field, value] of Object.entries(after)) changes[columnOf[field] as string] = value;

  const saved = await commit(ctx, [
    updateStatement("projects", id, changes),
    auditStatement(ctx, "project.updated", "project", id, { before, after }),
  ]);
  if (!saved.ok) return saved;
  return loadOrFail(ctx, id);
}

/** Marca atividade no projeto (para detectar projetos parados). Entra no lote de quem chamou. */
export function touchProjectStatement(ctx: CoreContext, projectId: string): Statement {
  return { sql: "UPDATE projects SET last_activity_at = ? WHERE id = ?", params: [nowIso(ctx), projectId] };
}

/**
 * Exclui o projeto. Tarefas, decisões e notas continuam existindo, só perdem o vínculo.
 * O conteúdo do histórico do projeto é apagado.
 */
export async function deleteProject(ctx: CoreContext, id: string): Promise<Result<{ id: string }>> {
  if (!(await exists(ctx, "projects", id))) return fail("not_found", "Projeto não encontrado.", { id });
  const saved = await commit(ctx, [
    { sql: "DELETE FROM projects WHERE id = ?", params: [id] },
    redactAuditStatement("project", id),
    auditStatement(ctx, "project.deleted", "project", id),
  ]);
  return saved.ok ? ok({ id }) : saved;
}

export const projectHistory = (ctx: CoreContext, id: string) => readHistory(ctx, "project", id);

async function loadOrFail(ctx: CoreContext, id: string): Promise<Result<Project>> {
  const project = await getProject(ctx, id);
  return project ? ok(project) : fail("storage_error", "O projeto foi salvo, mas não pôde ser relido.", { id });
}
