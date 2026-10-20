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
import { exists, idempotencyKeySchema, instantSchema, optionalText, parseInput, requiredText } from "./common";
import { touchProjectStatement } from "./projects";

/**
 * Uma decisão só existe depois que o usuário a confirma.
 * `proposedBy` registra quem teve a ideia: uma sugestão da SOPHIA aceita pelo
 * usuário continua identificada como tal, nunca atribuída ao usuário.
 */
export const DECISION_PROPOSERS = ["user", "sophia"] as const;
export type DecisionProposer = (typeof DECISION_PROPOSERS)[number];

export type DecisionStatus = "active" | "superseded";

export interface Decision {
  id: string;
  projectId: string | null;
  title: string;
  context: string | null;
  rationale: string | null;
  proposedBy: DecisionProposer;
  status: DecisionStatus;
  supersededBy: string | null;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const recordDecisionSchema = z.object({
  title: requiredText("A decisão", 500),
  context: optionalText(10000),
  rationale: optionalText(10000),
  projectId: z.string().min(1).nullable().optional(),
  proposedBy: z.enum(DECISION_PROPOSERS).optional(),
  decidedAt: instantSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type RecordDecisionInput = z.input<typeof recordDecisionSchema>;

interface DecisionRow {
  id: string;
  project_id: string | null;
  title: string;
  context: string | null;
  rationale: string | null;
  proposed_by: DecisionProposer;
  status: DecisionStatus;
  superseded_by: string | null;
  decided_at: string;
  created_at: string;
  updated_at: string;
}

const toDecision = (r: DecisionRow): Decision => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  context: r.context,
  rationale: r.rationale,
  proposedBy: r.proposed_by,
  status: r.status,
  supersededBy: r.superseded_by,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getDecision(ctx: CoreContext, id: string): Promise<Decision | null> {
  const rows = await ctx.db.select<DecisionRow>("SELECT * FROM decisions WHERE id = ?", [id]);
  return rows[0] ? toDecision(rows[0]) : null;
}

/** Por padrão, só decisões vigentes, da mais recente para a mais antiga. */
export async function listDecisions(
  ctx: CoreContext,
  filter: { projectId?: string | null; includeSuperseded?: boolean } = {},
): Promise<Decision[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (!filter.includeSuperseded) where.push("status = 'active'");
  if (filter.projectId !== undefined) {
    where.push("project_id IS ?");
    params.push(filter.projectId);
  }
  const rows = await ctx.db.select<DecisionRow>(
    `SELECT * FROM decisions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY decided_at DESC, created_at DESC`,
    params,
  );
  return rows.map(toDecision);
}

async function prepareDecision(
  ctx: CoreContext,
  input: RecordDecisionInput,
): Promise<Result<{ id: string; projectId: string | null; statements: Statement[] }>> {
  const parsed = parseInput(recordDecisionSchema, input);
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
    title: v.title,
    context: v.context ?? null,
    rationale: v.rationale ?? null,
    proposed_by: v.proposedBy ?? "user",
    status: "active",
    superseded_by: null,
    decided_at: v.decidedAt ? new Date(v.decidedAt).toISOString() : now,
    created_at: now,
    updated_at: now,
  } satisfies DecisionRow;
  const statements = [
    insertStatement("decisions", row),
    auditStatement(ctx, "decision.recorded", "decision", id, { after: row }),
  ];
  if (projectId) statements.push(touchProjectStatement(ctx, projectId));
  return ok({ id, projectId, statements });
}

export async function recordDecision(ctx: CoreContext, input: RecordDecisionInput): Promise<Result<Decision>> {
  return withIdempotency(ctx, input.idempotencyKey, "decision.record", (id) => getDecision(ctx, id), async () => {
    const prepared = await prepareDecision(ctx, input);
    if (!prepared.ok) return prepared;
    const { id, statements } = prepared.value;
    if (input.idempotencyKey) statements.push(operationStatement(ctx, input.idempotencyKey, "decision.record", "decision", id));
    const saved = await commit(ctx, statements);
    if (!saved.ok) return saved;
    return loadOrFail(ctx, id);
  });
}

/**
 * Revisa uma decisão: a antiga fica marcada como substituída (continua no
 * histórico), e a nova passa a ser a vigente. Se o projeto não for informado,
 * herda o da decisão antiga.
 */
export async function supersedeDecision(
  ctx: CoreContext,
  previousId: string,
  input: RecordDecisionInput,
): Promise<Result<Decision>> {
  const previous = await getDecision(ctx, previousId);
  if (!previous) return fail("not_found", "Decisão anterior não encontrada.", { id: previousId });
  if (previous.status === "superseded") {
    return fail("invalid_state", "Esta decisão já foi substituída por outra.", { supersededBy: previous.supersededBy });
  }
  const prepared = await prepareDecision(ctx, {
    ...input,
    projectId: input.projectId === undefined ? previous.projectId : input.projectId,
  });
  if (!prepared.ok) return prepared;
  const { id, statements } = prepared.value;
  statements.push(
    updateStatement("decisions", previousId, { status: "superseded", superseded_by: id, updated_at: nowIso(ctx) }),
    auditStatement(ctx, "decision.superseded", "decision", previousId, { supersededBy: id }),
  );
  const saved = await commit(ctx, statements);
  if (!saved.ok) return saved;
  return loadOrFail(ctx, id);
}

export const decisionHistory = (ctx: CoreContext, id: string) => readHistory(ctx, "decision", id);

async function loadOrFail(ctx: CoreContext, id: string): Promise<Result<Decision>> {
  const decision = await getDecision(ctx, id);
  return decision ? ok(decision) : fail("storage_error", "A decisão foi salva, mas não pôde ser relida.", { id });
}
