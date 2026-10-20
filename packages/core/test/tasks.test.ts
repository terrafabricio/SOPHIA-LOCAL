import { describe, expect, it } from "vitest";
import { createProject, getProject } from "../src/domain/projects";
import {
  completeTask,
  createTask,
  getTask,
  listTasks,
  taskHistory,
  updateTask,
} from "../src/domain/tasks";
import { count, expectError, makeCore, unwrap } from "./support/setup";

describe("tarefas", () => {
  it("[cenário 1] cria uma tarefa e ela pode ser recuperada do banco", async () => {
    const { ctx } = await makeCore();
    const created = unwrap(await createTask(ctx, { title: "  Resolver o domínio da empresa  ", dueDate: "2026-10-21" }));

    expect(created).toMatchObject({ title: "Resolver o domínio da empresa", status: "next", priority: "normal", dueDate: "2026-10-21" });
    expect(await getTask(ctx, created.id)).toEqual(created);
    expect((await listTasks(ctx)).map((t) => t.id)).toEqual([created.id]);
  });

  it("[cenário 2] a mesma solicitação processada duas vezes não cria duas tarefas", async () => {
    const core = await makeCore();
    const input = { title: "Pagar boleto", idempotencyKey: "req-abc-123" };

    const first = await createTask(core.ctx, input);
    const second = await createTask(core.ctx, input);

    expect(first.ok && second.ok).toBe(true);
    expect(unwrap(second).id).toBe(unwrap(first).id);
    expect(second.ok && second.duplicate).toBe(true);
    expect(await count(core, "tasks")).toBe(1);
  });

  it("[cenário 2] pedido novo com título igual a uma tarefa aberta é barrado até o usuário confirmar", async () => {
    const core = await makeCore();
    const original = unwrap(await createTask(core.ctx, { title: "Revisar capítulo 3" }));

    const blocked = expectError(await createTask(core.ctx, { title: "revisar  CAPÍTULO 3" }), "possible_duplicate");
    expect(blocked.details).toEqual({ existingId: original.id });
    expect(await count(core, "tasks")).toBe(1);

    unwrap(await createTask(core.ctx, { title: "revisar  CAPÍTULO 3", allowDuplicate: true }));
    expect(await count(core, "tasks")).toBe(2);
  });

  it("título igual a tarefa concluída ou de outro projeto não conta como duplicata", async () => {
    const { ctx } = await makeCore();
    const done = unwrap(await createTask(ctx, { title: "Backup" }));
    unwrap(await completeTask(ctx, done.id));
    unwrap(await createTask(ctx, { title: "Backup" }));

    const project = unwrap(await createProject(ctx, { name: "Servidor" }));
    unwrap(await createTask(ctx, { title: "Backup", projectId: project.id }));
  });

  it("recusa dados inválidos com mensagem em português e não grava nada", async () => {
    const core = await makeCore();
    expect(expectError(await createTask(core.ctx, { title: "   " }), "validation_error").message).toMatch(/vazio/);
    expect(expectError(await createTask(core.ctx, { title: "X", dueDate: "amanhã" }), "validation_error").message).toMatch(/AAAA-MM-DD/);
    expect(expectError(await createTask(core.ctx, { title: "X", estimateMinutes: 0 }), "validation_error").message).toMatch(/minutos/);
    expect(await count(core, "tasks")).toBe(0);
  });

  it("recusa projeto inexistente com not_found, sem estourar erro de banco", async () => {
    const { ctx } = await makeCore();
    expectError(await createTask(ctx, { title: "X", projectId: "nao-existe" }), "not_found");
  });

  it("atualização registra antes/depois no histórico", async () => {
    const { ctx, clock } = await makeCore();
    const task = unwrap(await createTask(ctx, { title: "Escrever newsletter" }));
    clock.advance(60_000);
    const updated = unwrap(await updateTask(ctx, task.id, { priority: "high", dueDate: "2026-10-25" }));

    expect(updated).toMatchObject({ priority: "high", dueDate: "2026-10-25" });
    expect(updated.updatedAt).not.toBe(task.updatedAt);
    const history = await taskHistory(ctx, task.id);
    expect(history.map((h) => h.action)).toEqual(["task.created", "task.updated"]);
    expect(history[1]?.data).toEqual({
      before: { priority: "normal", dueDate: null },
      after: { priority: "high", dueDate: "2026-10-25" },
    });
  });

  it("atualização sem mudança real não gera escrita nem histórico", async () => {
    const { ctx } = await makeCore();
    const task = unwrap(await createTask(ctx, { title: "A" }));
    unwrap(await updateTask(ctx, task.id, { title: "A", priority: "normal" }));
    expect((await taskHistory(ctx, task.id)).length).toBe(1);
  });

  it("rejeita campos desconhecidos na atualização", async () => {
    const { ctx } = await makeCore();
    const task = unwrap(await createTask(ctx, { title: "A" }));
    expectError(await updateTask(ctx, task.id, { completedAt: "2026-01-01" } as never), "validation_error");
  });

  it("concluir marca a data; reabrir limpa; concluir de novo não é erro", async () => {
    const { ctx } = await makeCore();
    const task = unwrap(await createTask(ctx, { title: "Enviar proposta" }));

    const done = unwrap(await completeTask(ctx, task.id));
    expect(done.status).toBe("done");
    expect(done.completedAt).toBe(ctx.clock.now().toISOString());

    const again = await completeTask(ctx, task.id);
    expect(again.ok && again.duplicate).toBe(true);

    const reopened = unwrap(await updateTask(ctx, task.id, { status: "next" }));
    expect(reopened.completedAt).toBeNull();
    expect((await taskHistory(ctx, task.id)).map((h) => h.action)).toEqual(["task.created", "task.completed", "task.updated"]);
  });

  it("lista exclui concluídas e canceladas por padrão e ordena por prazo", async () => {
    const { ctx } = await makeCore();
    const later = unwrap(await createTask(ctx, { title: "Depois", dueDate: "2026-12-01" }));
    const noDate = unwrap(await createTask(ctx, { title: "Sem data" }));
    const soon = unwrap(await createTask(ctx, { title: "Logo", dueDate: "2026-10-22" }));
    const cancelled = unwrap(await createTask(ctx, { title: "Cancelada", status: "cancelled" }));

    expect((await listTasks(ctx)).map((t) => t.id)).toEqual([soon.id, later.id, noDate.id]);
    expect((await listTasks(ctx, { includeClosed: true })).map((t) => t.id)).toContain(cancelled.id);
    expect((await listTasks(ctx, { statuses: ["cancelled"] })).map((t) => t.id)).toEqual([cancelled.id]);
  });

  it("mexer numa tarefa conta como atividade no projeto", async () => {
    const { ctx, clock } = await makeCore();
    const project = unwrap(await createProject(ctx, { name: "Livro de Tawa" }));
    clock.advance(86_400_000);
    unwrap(await createTask(ctx, { title: "Cena da caverna", projectId: project.id }));
    expect((await getProject(ctx, project.id))?.lastActivityAt).toBe(clock.now().toISOString());
  });
});
