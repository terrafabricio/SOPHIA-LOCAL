import { z } from "zod";
import { nowIso, type CoreContext } from "../context";
import { fail, ok, type Result } from "../result";
import type { Statement } from "../storage/driver";
import {
  auditStatement,
  commit,
  insertStatement,
  operationStatement,
  readHistory,
  redactAuditStatement,
  updateStatement,
  withIdempotency,
  type EntityType,
} from "../storage/write";
import { exists, idempotencyKeySchema, parseInput } from "./common";
import { getNote, prepareCreateNote, type CreateNoteInput, type Note } from "./notes";
import { getProject, prepareCreateProject, type CreateProjectInput, type Project } from "./projects";
import { listReminders, prepareCreateReminder, type Reminder } from "./reminders";
import { getTask, prepareCreateTask, type CreateTaskInput, type Task } from "./tasks";

export const INBOX_STATUSES = ["open", "converted", "archived"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const INBOX_KINDS = [
  "note",
  "idea",
  "opportunity",
  "task",
  "project",
  "decision",
  "reference",
  "appointment",
  "reminder",
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export type ConversionTarget = "task" | "project" | "note";

export interface InboxItem {
  id: string;
  text: string;
  source: string;
  status: InboxStatus;
  /** Sugestões (da IA, no futuro). São corrigíveis e nunca obrigatórias. */
  suggestedKind: InboxKind | null;
  suggestedCategoryId: string | null;
  convertedToType: ConversionTarget | null;
  convertedToId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Captura não exige nada além do texto. Categorizar é trabalho do sistema, depois. */
export const captureSchema = z.object({
  text: z
    .string({ error: "Escreva alguma coisa para capturar." })
    .refine((t) => t.trim().length > 0, { error: "Escreva alguma coisa para capturar." })
    .refine((t) => t.length <= 50000, { error: "Texto longo demais para uma captura (máx. 50.000 caracteres)." }),
  source: z.string().min(1).max(50).optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type CaptureInput = z.input<typeof captureSchema>;

interface InboxRow {
  id: string;
  text: string;
  source: string;
  status: InboxStatus;
  suggested_kind: InboxKind | null;
  suggested_category_id: string | null;
  converted_to_type: ConversionTarget | null;
  converted_to_id: string | null;
  created_at: string;
  updated_at: string;
}

const toItem = (r: InboxRow): InboxItem => ({
  id: r.id,
  text: r.text,
  source: r.source,
  status: r.status,
  suggestedKind: r.suggested_kind,
  suggestedCategoryId: r.suggested_category_id,
  convertedToType: r.converted_to_type,
  convertedToId: r.converted_to_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getInboxItem(ctx: CoreContext, id: string): Promise<InboxItem | null> {
  const rows = await ctx.db.select<InboxRow>("SELECT * FROM inbox_items WHERE id = ?", [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

/** Por padrão, só itens em aberto, do mais antigo para o mais novo. */
export async function listInbox(
  ctx: CoreContext,
  filter: { statuses?: readonly InboxStatus[] } = {},
): Promise<InboxItem[]> {
  const statuses = filter.statuses?.length ? filter.statuses : (["open"] as const);
  const rows = await ctx.db.select<InboxRow>(
    `SELECT * FROM inbox_items WHERE status IN (${statuses.map(() => "?").join(", ")}) ORDER BY created_at`,
    statuses,
  );
  return rows.map(toItem);
}

export async function capture(ctx: CoreContext, input: CaptureInput): Promise<Result<InboxItem>> {
  return withIdempotency(ctx, input.idempotencyKey, "inbox.capture", (id) => getInboxItem(ctx, id), async () => {
    const parsed = parseInput(captureSchema, input);
    if (!parsed.ok) return parsed;
    const id = ctx.newId();
    const now = nowIso(ctx);
    const row = {
      id,
      text: parsed.value.text,
      source: parsed.value.source ?? "quick_capture",
      status: "open",
      suggested_kind: null,
      suggested_category_id: null,
      converted_to_type: null,
      converted_to_id: null,
      created_at: now,
      updated_at: now,
    } satisfies InboxRow;
    const statements = [insertStatement("inbox_items", row), auditStatement(ctx, "inbox.captured", "inbox_item", id, { after: row })];
    if (parsed.value.idempotencyKey) {
      statements.push(operationStatement(ctx, parsed.value.idempotencyKey, "inbox.capture", "inbox_item", id));
    }
    const saved = await commit(ctx, statements);
    if (!saved.ok) return saved;
    const item = await getInboxItem(ctx, id);
    return item ? ok(item) : fail("storage_error", "A captura foi salva, mas não pôde ser relida.", { id });
  });
}

const suggestionSchema = z.object({
  suggestedKind: z.enum(INBOX_KINDS).nullable().optional(),
  suggestedCategoryId: z.string().min(1).nullable().optional(),
});

/** Registra ou corrige a classificação sugerida (pela IA ou pelo usuário). */
export async function setInboxSuggestion(
  ctx: CoreContext,
  id: string,
  input: z.input<typeof suggestionSchema>,
): Promise<Result<InboxItem>> {
  const parsed = parseInput(suggestionSchema, input);
  if (!parsed.ok) return parsed;
  const current = await getInboxItem(ctx, id);
  if (!current) return fail("not_found", "Item da Inbox não encontrado.", { id });
  const { suggestedKind, suggestedCategoryId } = parsed.value;
  if (suggestedCategoryId && !(await exists(ctx, "categories", suggestedCategoryId))) {
    return fail("not_found", "Categoria não encontrada.", { categoryId: suggestedCategoryId });
  }
  const changes = {
    suggested_kind: suggestedKind === undefined ? current.suggestedKind : suggestedKind,
    suggested_category_id: suggestedCategoryId === undefined ? current.suggestedCategoryId : suggestedCategoryId,
    updated_at: nowIso(ctx),
  };
  const saved = await commit(ctx, [
    updateStatement("inbox_items", id, changes),
    auditStatement(ctx, "inbox.suggestion_set", "inbox_item", id, {
      kind: changes.suggested_kind,
      categoryId: changes.suggested_category_id,
    }),
  ]);
  if (!saved.ok) return saved;
  return reload(ctx, id);
}

/** Título derivado do texto capturado: primeira linha não vazia, encurtada se preciso. */
export function deriveTitle(text: string, max = 120): string {
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? text.trim();
  return firstLine.length <= max ? firstLine : `${firstLine.slice(0, max - 1).trimEnd()}…`;
}

function descriptionFrom(text: string, title: string): string | null {
  return text.trim() === title ? null : text.trim();
}

interface ConversionResult<T> {
  item: InboxItem;
  created: T;
}

/**
 * Converte um item aberto da Inbox, numa única transação: cria o destino e
 * marca o item como convertido. Se algo falhar, nada muda.
 */
async function convert<T>(
  ctx: CoreContext,
  itemId: string,
  target: ConversionTarget,
  prepare: (item: InboxItem) => Promise<Result<{ id: string; statements: Statement[] }>>,
  load: (id: string) => Promise<T | null>,
): Promise<Result<ConversionResult<T>>> {
  const item = await getInboxItem(ctx, itemId);
  if (!item) return fail("not_found", "Item da Inbox não encontrado.", { id: itemId });
  if (item.status !== "open") {
    return fail("invalid_state", "Este item já foi convertido ou arquivado.", {
      status: item.status,
      convertedToType: item.convertedToType,
      convertedToId: item.convertedToId,
    });
  }

  const prepared = await prepare(item);
  if (!prepared.ok) return prepared;
  const createdId = prepared.value.id;

  const saved = await commit(ctx, [
    ...prepared.value.statements,
    updateStatement("inbox_items", itemId, {
      status: "converted",
      converted_to_type: target,
      converted_to_id: createdId,
      updated_at: nowIso(ctx),
    }),
    auditStatement(ctx, "inbox.converted", "inbox_item", itemId, { to: target, id: createdId }),
  ]);
  if (!saved.ok) return saved;

  const [updated, created] = await Promise.all([getInboxItem(ctx, itemId), load(createdId)]);
  if (!updated || !created) {
    return fail("storage_error", "A conversão foi salva, mas não pôde ser relida.", { itemId, createdId });
  }
  return ok({ item: updated, created });
}

export interface ConvertToTaskOptions extends Omit<CreateTaskInput, "idempotencyKey" | "title"> {
  title?: string;
  /** Lembrete criado no mesmo lote da tarefa: ou os dois são gravados, ou nenhum. */
  reminder?: { dueAt: string; timezone: string; title?: string };
}

export async function convertInboxToTask(
  ctx: CoreContext,
  itemId: string,
  options: ConvertToTaskOptions = {},
): Promise<Result<ConversionResult<Task> & { reminder: Reminder | null }>> {
  const { reminder, ...overrides } = options;
  const converted = await convert(
    ctx,
    itemId,
    "task",
    async (item) => {
      const title = overrides.title ?? deriveTitle(item.text);
      const task = await prepareCreateTask(
        ctx,
        { description: descriptionFrom(item.text, title), ...overrides, title },
        { inboxItemId: item.id },
      );
      if (!task.ok || !reminder) return task;
      const rem = await prepareCreateReminder(
        ctx,
        { title: reminder.title ?? title, dueAt: reminder.dueAt, timezone: reminder.timezone, taskId: task.value.id },
        { taskCreatedInSameBatch: true },
      );
      if (!rem.ok) return rem;
      return ok({ id: task.value.id, statements: [...task.value.statements, ...rem.value.statements] });
    },
    (id) => getTask(ctx, id),
  );
  if (!converted.ok) return converted;
  const [created] = reminder ? await listReminders(ctx, { taskId: converted.value.created.id }) : [];
  return ok({ ...converted.value, reminder: created ?? null });
}

export function convertInboxToProject(
  ctx: CoreContext,
  itemId: string,
  overrides: Omit<CreateProjectInput, "idempotencyKey" | "name"> & { name?: string } = {},
): Promise<Result<ConversionResult<Project>>> {
  return convert(
    ctx,
    itemId,
    "project",
    (item) => {
      const name = overrides.name ?? deriveTitle(item.text);
      return prepareCreateProject(
        ctx,
        {
          objective: descriptionFrom(item.text, name),
          categoryId: item.suggestedCategoryId,
          ...overrides,
          name,
        },
        { inboxItemId: item.id },
      );
    },
    (id) => getProject(ctx, id),
  );
}

export function convertInboxToNote(
  ctx: CoreContext,
  itemId: string,
  overrides: Omit<CreateNoteInput, "idempotencyKey" | "body"> = {},
): Promise<Result<ConversionResult<Note>>> {
  return convert(
    ctx,
    itemId,
    "note",
    (item) => {
      const kind = overrides.kind ?? (item.suggestedKind === "idea" || item.suggestedKind === "reference" ? item.suggestedKind : "note");
      return prepareCreateNote(ctx, { ...overrides, kind, body: item.text }, { inboxItemId: item.id });
    },
    (id) => getNote(ctx, id),
  );
}

/** Arquivar não apaga: tira o item da Inbox ativa, mas ele continua consultável. */
export async function archiveInboxItem(ctx: CoreContext, id: string): Promise<Result<InboxItem>> {
  const item = await getInboxItem(ctx, id);
  if (!item) return fail("not_found", "Item da Inbox não encontrado.", { id });
  if (item.status === "archived") return ok(item, true);
  if (item.status === "converted") return fail("invalid_state", "Item já convertido.", { convertedToId: item.convertedToId });
  const saved = await commit(ctx, [
    updateStatement("inbox_items", id, { status: "archived", updated_at: nowIso(ctx) }),
    auditStatement(ctx, "inbox.archived", "inbox_item", id),
  ]);
  if (!saved.ok) return saved;
  return reload(ctx, id);
}

/** Excluir apaga o texto de verdade (inclusive do histórico). O que foi criado a partir dele permanece. */
export async function deleteInboxItem(ctx: CoreContext, id: string): Promise<Result<{ id: string }>> {
  if (!(await exists(ctx, "inbox_items", id))) return fail("not_found", "Item da Inbox não encontrado.", { id });
  const entity: EntityType = "inbox_item";
  const saved = await commit(ctx, [
    { sql: "DELETE FROM inbox_items WHERE id = ?", params: [id] },
    redactAuditStatement(entity, id),
    auditStatement(ctx, "inbox.deleted", entity, id),
  ]);
  return saved.ok ? ok({ id }) : saved;
}

export const inboxHistory = (ctx: CoreContext, id: string) => readHistory(ctx, "inbox_item", id);

async function reload(ctx: CoreContext, id: string): Promise<Result<InboxItem>> {
  const item = await getInboxItem(ctx, id);
  return item ? ok(item) : fail("storage_error", "O item foi salvo, mas não pôde ser relido.", { id });
}
