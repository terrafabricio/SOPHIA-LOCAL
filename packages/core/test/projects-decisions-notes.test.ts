import { describe, expect, it } from "vitest";
import { listDecisions, recordDecision, supersedeDecision } from "../src/domain/decisions";
import { createNote, listNotes, updateNote } from "../src/domain/notes";
import { createProject, listProjects, projectHistory, updateProject } from "../src/domain/projects";
import { expectError, makeCore, unwrap } from "./support/setup";

describe("projetos", () => {
  it("uma ideia não vira projeto ativo sozinha: o estado padrão é 'idea'", async () => {
    const { ctx } = await makeCore();
    const project = unwrap(await createProject(ctx, { name: "Edith" }));
    expect(project).toMatchObject({ status: "idea", priority: "normal", nextStep: null });
  });

  it("registra objetivo, estado e próximo passo, com histórico", async () => {
    const { ctx } = await makeCore();
    const p = unwrap(await createProject(ctx, { name: "SOPHIA-LOCAL", objective: "Sistema pessoal local-first" }));
    const updated = unwrap(await updateProject(ctx, p.id, { status: "active", nextStep: "Etapa 2: captura" }));
    expect(updated).toMatchObject({ status: "active", nextStep: "Etapa 2: captura" });
    expect((await projectHistory(ctx, p.id)).at(-1)?.data).toEqual({
      before: { status: "idea", nextStep: null },
      after: { status: "active", nextStep: "Etapa 2: captura" },
    });
  });

  it("filtra por estado e ordena por atividade mais recente", async () => {
    const { ctx, clock } = await makeCore();
    const a = unwrap(await createProject(ctx, { name: "A", status: "active" }));
    clock.advance(1000);
    const b = unwrap(await createProject(ctx, { name: "B", status: "active" }));
    unwrap(await createProject(ctx, { name: "C", status: "paused" }));
    expect((await listProjects(ctx, { statuses: ["active"] })).map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("categoria inexistente é recusada", async () => {
    const { ctx } = await makeCore();
    expectError(await createProject(ctx, { name: "X", categoryId: "nao-existe" }), "not_found");
  });
});

describe("decisões", () => {
  it("[cenário 7] registra contexto e justificativa e recupera exatamente o registrado", async () => {
    const { ctx } = await makeCore();
    const p = unwrap(await createProject(ctx, { name: "SOPHIA-LOCAL" }));
    const d = unwrap(
      await recordDecision(ctx, {
        projectId: p.id,
        title: "Usar Tauri + TypeScript",
        context: "App desktop no Mac",
        rationale: "Uma linguagem só para manter",
      }),
    );
    expect(await listDecisions(ctx, { projectId: p.id })).toEqual([d]);
    expect(d.proposedBy).toBe("user");
  });

  it("sugestão da SOPHIA aceita continua marcada como sugestão da SOPHIA", async () => {
    const { ctx } = await makeCore();
    const d = unwrap(await recordDecision(ctx, { title: "Pausar o projeto X", proposedBy: "sophia" }));
    expect(d.proposedBy).toBe("sophia");
  });

  it("revisar uma decisão: a antiga sai da lista vigente, mas continua no histórico", async () => {
    const { ctx, clock } = await makeCore();
    const p = unwrap(await createProject(ctx, { name: "P" }));
    const old = unwrap(await recordDecision(ctx, { projectId: p.id, title: "Lançar em novembro" }));
    clock.advance(1000);
    const next = unwrap(await supersedeDecision(ctx, old.id, { title: "Lançar em janeiro", rationale: "Escopo maior" }));

    expect(next.projectId).toBe(p.id);
    expect(await listDecisions(ctx, { projectId: p.id })).toEqual([next]);
    const all = await listDecisions(ctx, { projectId: p.id, includeSuperseded: true });
    expect(all.find((d) => d.id === old.id)).toMatchObject({ status: "superseded", supersededBy: next.id });
    expectError(await supersedeDecision(ctx, old.id, { title: "outra" }), "invalid_state");
  });
});

describe("notas", () => {
  it("[cenário 5] nota marcada como desatualizada deixa de aparecer como atual", async () => {
    const { ctx } = await makeCore();
    const n = unwrap(await createNote(ctx, { body: "O banco é Postgres na nuvem" }));
    unwrap(await createNote(ctx, { body: "O banco é SQLite local" }));
    unwrap(await updateNote(ctx, n.id, { status: "outdated" }));

    expect((await listNotes(ctx)).map((x) => x.body)).toEqual(["O banco é SQLite local"]);
    expect((await listNotes(ctx, { includeOutdated: true })).length).toBe(2);
  });

  it("[cenário 5] corrigir o texto substitui a versão atual", async () => {
    const { ctx } = await makeCore();
    const n = unwrap(await createNote(ctx, { body: "Reunião na terça" }));
    unwrap(await updateNote(ctx, n.id, { body: "Reunião na quarta" }));
    expect((await listNotes(ctx)).map((x) => x.body)).toEqual(["Reunião na quarta"]);
  });
});
