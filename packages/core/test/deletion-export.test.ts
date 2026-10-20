import { describe, expect, it } from "vitest";
import { exportAll, EXPORT_TABLES } from "../src/export";
import { capture, convertInboxToTask, deleteInboxItem, inboxHistory } from "../src/domain/inbox";
import { createNote, deleteNote } from "../src/domain/notes";
import { createProject, deleteProject } from "../src/domain/projects";
import { createReminder, getReminder } from "../src/domain/reminders";
import { createTask, deleteTask, getTask, taskHistory, updateTask } from "../src/domain/tasks";
import { count, expectError, makeCore, unwrap } from "./support/setup";

describe("exclusão", () => {
  it("[cenário 6] excluir tarefa apaga o registro, os lembretes e o conteúdo do histórico", async () => {
    const core = await makeCore();
    const { ctx } = core;
    const secret = "Consulta médica confidencial";
    const t = unwrap(await createTask(ctx, { title: secret }));
    unwrap(await updateTask(ctx, t.id, { description: `${secret} — detalhes` }));
    const r = unwrap(await createReminder(ctx, { title: secret, dueAt: "2026-10-21T12:00:00Z", timezone: "UTC", taskId: t.id }));

    unwrap(await deleteTask(ctx, t.id));

    expect(await getTask(ctx, t.id)).toBeNull();
    expect(await getReminder(ctx, r.id)).toBeNull();
    const history = await taskHistory(ctx, t.id);
    expect(history.map((h) => h.action)).toEqual(["task.created", "task.updated", "task.deleted"]);
    expect(history.every((h) => h.data === null)).toBe(true);
    expect(JSON.stringify(await exportAll(ctx))).not.toContain(secret);
    expectError(await deleteTask(ctx, t.id), "not_found");
  });

  it("excluir a captura apaga o texto, mas mantém a tarefa criada a partir dela", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "texto original da captura" }));
    const { created } = unwrap(await convertInboxToTask(ctx, item.id, { title: "Tarefa derivada" }));

    unwrap(await deleteInboxItem(ctx, item.id));

    expect((await inboxHistory(ctx, item.id)).every((h) => h.data === null)).toBe(true);
    expect(await getTask(ctx, created.id)).toMatchObject({ title: "Tarefa derivada", inboxItemId: null });
  });

  it("excluir projeto mantém tarefas e notas, só desfaz o vínculo", async () => {
    const core = await makeCore();
    const p = unwrap(await createProject(core.ctx, { name: "P" }));
    const t = unwrap(await createTask(core.ctx, { title: "T", projectId: p.id }));
    unwrap(await createNote(core.ctx, { body: "N", projectId: p.id }));

    unwrap(await deleteProject(core.ctx, p.id));

    expect((await getTask(core.ctx, t.id))?.projectId).toBeNull();
    expect(await count(core, "notes")).toBe(1);
  });

  it("excluir nota apaga o registro", async () => {
    const core = await makeCore();
    const n = unwrap(await createNote(core.ctx, { body: "efêmera" }));
    unwrap(await deleteNote(core.ctx, n.id));
    expect(await count(core, "notes")).toBe(0);
  });
});

describe("exportação", () => {
  it("exporta todas as tabelas do usuário em JSON, com a versão do schema", async () => {
    const { ctx } = await makeCore();
    unwrap(await capture(ctx, { text: "ideia" }));
    unwrap(await createTask(ctx, { title: "tarefa" }));

    const data = await exportAll(ctx);
    expect(data).toMatchObject({ format: "sophia-local-export", formatVersion: 1, schemaVersion: 1 });
    expect(Object.keys(data.tables)).toEqual([...EXPORT_TABLES]);
    expect(data.tables.inbox_items).toHaveLength(1);
    expect(data.tables.tasks).toHaveLength(1);
    expect(data.tables.categories).toHaveLength(8);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
