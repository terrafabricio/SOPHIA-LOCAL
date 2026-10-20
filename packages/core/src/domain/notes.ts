import { z } from "zod";
import { nowIso, type CoreContext } from "../context";
import { fail, ok, type Result } from "../result";
import type { SqlValue, Statement } from "../storage/driver";
import {
  auditStatement,
  commit,
  insertStatement,
  operationStatement,
  redactAuditStatement,
  updateStatement,
  withIdempotency,
} from "../storage/write";
import { exists, idempotencyKeySchema, optionalText, parseInput, requiredText } from "./common";
import { touchProjectStatement } from "./projects";

export const NOTE_KINDS = ["note", "idea", "reference"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** "outdated" mantém o registro, mas ele deixa de ser apresentado como informação atual. */
export const NOTE_STATUSES = ["current", "outdated"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export interface Note {
  id: string;
  projectId: string | null;
  title: string | null;
  body: string;
  kind: NoteKind;
  status: NoteStatus;
  inboxItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const createNoteSchema = z.object({
  body: requiredText("O texto da nota", 50000),
  title: optionalText(300),
  kind: z.enum(NOTE_KINDS).optional(),
  projectId: z.string().min(1).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type CreateNoteInput = z.input<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    body: requiredText("O texto da nota", 50000).optional(),
    title: optionalText(300),
    kind: z.enum(NOTE_KINDS).optional(),
    status: z.enum(NOTE_STATUSES).optional(),
  })
  .strict();
export type UpdateNoteInput = z.input<typeof updateNoteSchema>;

interface NoteRow {
  id: string;
  project_id: string | null;
  title: string | null;
  body: string;
  kind: NoteKind;
  status: NoteStatus;
  inbox_item_id: string | null;
  created_at: string;
  updated_at: string;
}

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  body: r.body,
  kind: r.kind,
  status: r.status,
  inboxItemId: r.inbox_item_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getNote(ctx: CoreContext, id: string): Promise<Note | null> {
  const rows = await ctx.db.select<NoteRow>("SELECT * FROM notes WHERE id = ?", [id]);
  return rows[0] ? toNote(rows[0]) : null;
}

export async function listNotes(
  ctx: CoreContext,
  filter: { projectId?: string | null; includeOutdated?: boolean } = {},
): Promise<Note[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (!filter.includeOutdated) where.push("status = 'current'");
  if (filter.projectId !== undefined) {
    where.push("project_id IS ?");
    params.push(filter.projectId);
  }
  const rows = await ctx.db.select<NoteRow>(
    `SELECT * FROM notes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`,
    params,
  );
  return rows.map(toNote);
}

export async function prepareCreateNote(
  ctx: CoreContext,
  input: CreateNoteInput,
  extra: { inboxItemId?: string } = {},
): Promise<Result<{ id: string; statements: Statement[] }>> {
  const parsed = parseInput(createNoteSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const projectId = v.projectId ?? null;
  if (projectId && !(await exists(ctx, "projects", projectId))) {
    return fail("not_found", "Projeto não encontrado.", { projectId });
  }
  const id = ctx.newId();
  const now = nowIso(ctx);
  const row = {
    id,
    project_id: projectId,
    title: v.title ?? null,
    body: v.body,
    kind: v.kind ?? "note",
    status: "current",
    inbox_item_id: extra.inboxItemId ?? null,
    created_at: now,
    updated_at: now,
  } satisfies NoteRow;
  const statements = [insertStatement("notes", row), auditStatement(ctx, "note.created", "note", id, { after: row })];
  if (projectId) statements.push(touchProjectStatement(ctx, projectId));
  if (v.idempotencyKey) statements.push(operationStatement(ctx, v.idempotencyKey, "note.create", "note", id));
  return ok({ id, statements });
}

export async function createNote(ctx: CoreContext, input: CreateNoteInput): Promise<Result<Note>> {
  return withIdempotency(ctx, input.idempotencyKey, "note.create", (id) => getNote(ctx, id), async () => {
    const prepared = await prepareCreateNote(ctx, input);
    if (!prepared.ok) return prepared;
    const saved = await commit(ctx, prepared.value.statements);
    if (!saved.ok) return saved;
    return loadOrFail(ctx, prepared.value.id);
  });
}

export async function updateNote(ctx: CoreContext, id: string, patch: UpdateNoteInput): Promise<Result<Note>> {
  const parsed = parseInput(updateNoteSchema, patch);
  if (!parsed.ok) return parsed;
  const current = await getNote(ctx, id);
  if (!current) return fail("not_found", "Nota não encontrada.", { id });

  const before: Record<string, unknown> = {};
  const after: Record<string, SqlValue> = {};
  for (const [field, value] of Object.entries(parsed.value)) {
    if (value === undefined || current[field as keyof Note] === value) continue;
    before[field] = current[field as keyof Note];
    after[field] = value as SqlValue;
  }
  if (Object.keys(after).length === 0) return ok(current);

  const statements: Statement[] = [
    updateStatement("notes", id, { ...after, updated_at: nowIso(ctx) }),
    auditStatement(ctx, "note.updated", "note", id, { before, after }),
  ];
  if (current.projectId) statements.push(touchProjectStatement(ctx, current.projectId));
  const saved = await commit(ctx, statements);
  if (!saved.ok) return saved;
  return loadOrFail(ctx, id);
}

export async function deleteNote(ctx: CoreContext, id: string): Promise<Result<{ id: string }>> {
  if (!(await exists(ctx, "notes", id))) return fail("not_found", "Nota não encontrada.", { id });
  const saved = await commit(ctx, [
    { sql: "DELETE FROM notes WHERE id = ?", params: [id] },
    redactAuditStatement("note", id),
    auditStatement(ctx, "note.deleted", "note", id),
  ]);
  return saved.ok ? ok({ id }) : saved;
}

async function loadOrFail(ctx: CoreContext, id: string): Promise<Result<Note>> {
  const note = await getNote(ctx, id);
  return note ? ok(note) : fail("storage_error", "A nota foi salva, mas não pôde ser relida.", { id });
}
