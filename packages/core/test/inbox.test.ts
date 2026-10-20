import { describe, expect, it } from "vitest";
import {
  archiveInboxItem,
  capture,
  convertInboxToNote,
  convertInboxToProject,
  convertInboxToTask,
  deriveTitle,
  getInboxItem,
  listInbox,
  setInboxSuggestion,
} from "../src/domain/inbox";
import { createTask } from "../src/domain/tasks";
import { count, expectError, makeCore, unwrap } from "./support/setup";

describe("captura e Inbox", () => {
  it("captura só com texto, sem exigir categoria, data ou projeto", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "ideia: SOPHIA ler o feed do Laya no futuro" }));
    expect(item).toMatchObject({ status: "open", source: "quick_capture", suggestedKind: null, suggestedCategoryId: null });
    expect((await listInbox(ctx)).map((i) => i.id)).toEqual([item.id]);
  });

  it("preserva o texto exatamente como foi escrito (mensagens longas e desorganizadas)", async () => {
    const { ctx } = await makeCore();
    const text = "  pensei agora:\n\n- trocar o domínio\n- falar com o contador   \n";
    expect(unwrap(await capture(ctx, { text })).text).toBe(text);
  });

  it("recusa captura vazia", async () => {
    const { ctx } = await makeCore();
    expectError(await capture(ctx, { text: "  \n " }), "validation_error");
  });

  it("captura com a mesma chave (duplo Enter) grava uma vez só", async () => {
    const core = await makeCore();
    unwrap(await capture(core.ctx, { text: "x", idempotencyKey: "capture-0001" }));
    const again = await capture(core.ctx, { text: "x", idempotencyKey: "capture-0001" });
    expect(again.ok && again.duplicate).toBe(true);
    expect(await count(core, "inbox_items")).toBe(1);
  });

  it("deriva o título da primeira linha não vazia e encurta textos longos", () => {
    expect(deriveTitle("\n  Ligar para o banco \n detalhes...")).toBe("Ligar para o banco");
    const long = deriveTitle("a".repeat(300));
    expect(long.length).toBe(120);
    expect(long.endsWith("…")).toBe(true);
  });

  it("converte em tarefa: cria a tarefa, liga à origem e tira o item da Inbox", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "Resolver domínio da empresa\nVer se renova por 2 anos" }));
    const { item: converted, created } = unwrap(await convertInboxToTask(ctx, item.id, { dueDate: "2026-10-21" }));

    expect(created).toMatchObject({
      title: "Resolver domínio da empresa",
      description: "Resolver domínio da empresa\nVer se renova por 2 anos",
      dueDate: "2026-10-21",
      inboxItemId: item.id,
    });
    expect(converted).toMatchObject({ status: "converted", convertedToType: "task", convertedToId: created.id });
    expect(await listInbox(ctx)).toEqual([]);
  });

  it("item já convertido não pode ser convertido de novo", async () => {
    const core = await makeCore();
    const item = unwrap(await capture(core.ctx, { text: "Algo" }));
    unwrap(await convertInboxToTask(core.ctx, item.id));
    expectError(await convertInboxToProject(core.ctx, item.id), "invalid_state");
    expect(await count(core, "projects")).toBe(0);
  });

  it("converte em projeto (estado inicial 'idea', herda a categoria sugerida)", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "Canal no YouTube sobre escrita" }));
    unwrap(await setInboxSuggestion(ctx, item.id, { suggestedKind: "project", suggestedCategoryId: "conteudo" }));
    const { created } = unwrap(await convertInboxToProject(ctx, item.id));
    expect(created).toMatchObject({ name: "Canal no YouTube sobre escrita", status: "idea", categoryId: "conteudo" });
  });

  it("converte em nota usando o tipo sugerido quando cabe", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "A caverna-biblioteca guarda línguas mortas" }));
    unwrap(await setInboxSuggestion(ctx, item.id, { suggestedKind: "idea" }));
    const { created } = unwrap(await convertInboxToNote(ctx, item.id));
    expect(created).toMatchObject({ kind: "idea", body: "A caverna-biblioteca guarda línguas mortas", status: "current" });
  });

  it("sugestão com categoria inexistente é recusada", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "x" }));
    expectError(await setInboxSuggestion(ctx, item.id, { suggestedCategoryId: "nao-existe" }), "not_found");
  });

  it("arquivar tira da Inbox sem apagar", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "talvez um dia" }));
    unwrap(await archiveInboxItem(ctx, item.id));
    expect(await listInbox(ctx)).toEqual([]);
    expect((await listInbox(ctx, { statuses: ["archived"] })).map((i) => i.id)).toEqual([item.id]);
  });

  it("[cenário 10] falha no meio da conversão não deixa estado pela metade", async () => {
    const core = await makeCore();
    const item = unwrap(await capture(core.ctx, { text: "Tarefa importante" }));

    // Falha depois que o INSERT da tarefa já rodou dentro da transação.
    core.db.beforeStatement = (_i, s) => {
      if (s.sql.startsWith("UPDATE inbox_items")) throw new Error("disco cheio (simulado)");
    };
    const result = await convertInboxToTask(core.ctx, item.id);
    core.db.beforeStatement = undefined;

    const error = expectError(result, "storage_error");
    expect(error.message).toMatch(/Nada foi alterado/);
    expect(await count(core, "tasks")).toBe(0);
    expect((await getInboxItem(core.ctx, item.id))?.status).toBe("open");

    // Recuperação: a mesma operação funciona depois.
    unwrap(await convertInboxToTask(core.ctx, item.id));
    expect(await count(core, "tasks")).toBe(1);
  });

  it("conversão respeita a proteção contra tarefa duplicada", async () => {
    const { ctx } = await makeCore();
    unwrap(await createTask(ctx, { title: "Comprar café" }));
    const item = unwrap(await capture(ctx, { text: "comprar café" }));
    expectError(await convertInboxToTask(ctx, item.id), "possible_duplicate");
    expect((await getInboxItem(ctx, item.id))?.status).toBe("open");
  });
});
