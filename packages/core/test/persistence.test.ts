import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDecisions, recordDecision } from "../src/domain/decisions";
import { capture, listInbox } from "../src/domain/inbox";
import { createNote, listNotes } from "../src/domain/notes";
import { createProject, listProjects } from "../src/domain/projects";
import { createReminder, listReminders } from "../src/domain/reminders";
import { createTask, listTasks } from "../src/domain/tasks";
import { migrate } from "../src/storage/migrate";
import { makeCore, unwrap } from "./support/setup";

describe("[cenário 12] reinício da aplicação", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sophia-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("tarefas, projetos, capturas, decisões, notas e lembretes sobrevivem a fechar e reabrir o banco", async () => {
    const path = join(dir, "sophia.db");

    const first = await makeCore(path);
    const p = unwrap(await createProject(first.ctx, { name: "Livro de Tawa", status: "active" }));
    unwrap(await createTask(first.ctx, { title: "Revisar cena 4", projectId: p.id, dueDate: "2026-10-25" }));
    unwrap(await capture(first.ctx, { text: "nanorrobôs como linguagem?" }));
    unwrap(await recordDecision(first.ctx, { projectId: p.id, title: "Narrador em 3ª pessoa" }));
    unwrap(await createNote(first.ctx, { body: "A caverna tem 7 salas", projectId: p.id }));
    unwrap(await createReminder(first.ctx, { title: "Revisar", dueAt: "2026-10-25T12:00:00Z", timezone: "America/Sao_Paulo" }));
    first.db.close();

    const second = await makeCore(path);
    expect(await migrate(second.db)).toEqual([]);
    expect((await listProjects(second.ctx)).map((x) => x.name)).toEqual(["Livro de Tawa"]);
    expect((await listTasks(second.ctx)).map((x) => x.title)).toEqual(["Revisar cena 4"]);
    expect((await listInbox(second.ctx)).map((x) => x.text)).toEqual(["nanorrobôs como linguagem?"]);
    expect((await listDecisions(second.ctx)).map((x) => x.title)).toEqual(["Narrador em 3ª pessoa"]);
    expect((await listNotes(second.ctx)).map((x) => x.body)).toEqual(["A caverna tem 7 salas"]);
    expect((await listReminders(second.ctx)).map((x) => [x.title, x.status])).toEqual([["Revisar", "pending"]]);
    second.db.close();
  });
});
