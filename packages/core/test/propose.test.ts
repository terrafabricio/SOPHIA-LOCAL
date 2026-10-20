import { describe, expect, it } from "vitest";
import { chooseOption, proposeTask, proposeTaskFromInbox } from "../src/capture/propose";
import { capture, convertInboxToTask, getInboxItem } from "../src/domain/inbox";
import { count, expectError, makeCore, testClock, unwrap } from "./support/setup";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-10-20T12:00:00Z"); // terça, 09:00 em São Paulo

describe("proposta de tarefa a partir de texto", () => {
  it("exemplo da especificação: título limpo e prazo, sem lembrete (não há horário)", () => {
    const p = proposeTask("Preciso resolver o domínio da empresa amanhã.", { now: NOW, timeZone: TZ });
    expect(p).toMatchObject({
      title: "Preciso resolver o domínio da empresa",
      description: "Preciso resolver o domínio da empresa amanhã.",
      dueDate: "2026-10-21",
      reminder: null,
      needsClarification: false,
    });
  });

  it("com horário, propõe também o lembrete", () => {
    const p = proposeTask("ligar para o contador amanhã às 14h", { now: NOW, timeZone: TZ });
    expect(p).toMatchObject({
      title: "Ligar para o contador",
      dueDate: "2026-10-21",
      reminder: { dueAt: "2026-10-21T17:00:00.000Z", timezone: TZ },
    });
  });

  it("[cenário 9] data ambígua: não preenche prazo e pede escolha", () => {
    const p = proposeTask("Enviar orçamento próxima sexta", { now: NOW, timeZone: TZ });
    expect(p).toMatchObject({ dueDate: null, reminder: null, needsClarification: true, notes: ["Qual destas datas?"] });

    const chosen = unwrap(chooseOption(p, 1, TZ));
    expect(chosen).toMatchObject({ dueDate: "2026-10-30", needsClarification: false });
    expectError(chooseOption(p, 5, TZ), "validation_error");
    expectError(chooseOption(chosen, 0, TZ), "invalid_state");
  });

  it("período vago: guarda sem prazo e explica", () => {
    const p = proposeTask("organizar a garagem semana que vem", { now: NOW, timeZone: TZ });
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe("Organizar a garagem");
    expect(p.notes[0]).toMatch(/não define um dia/);
  });

  it("suposições aparecem nas notas", () => {
    const p = proposeTask("pagar aluguel dia 5", { now: NOW, timeZone: TZ });
    expect(p.dueDate).toBe("2026-11-05");
    expect(p.notes[0]).toMatch(/já passou/);
  });
});

describe("da Inbox à tarefa com prazo e lembrete", () => {
  it("[cenário 9] fluxo completo com pergunta: captura → proposta → escolha → tarefa + lembrete", async () => {
    const core = await makeCore(":memory:", testClock(NOW.toISOString()));
    const { ctx } = core;

    // A captura nunca é bloqueada pela ambiguidade.
    const item = unwrap(await capture(ctx, { text: "Ligar pro contador amanhã às 3" }));

    const proposal = unwrap(await proposeTaskFromInbox(ctx, item.id, { timeZone: TZ }));
    expect(proposal.needsClarification).toBe(true);
    const chosen = unwrap(chooseOption(proposal, 1, TZ)); // 15:00

    const { created, reminder, item: converted } = unwrap(
      await convertInboxToTask(ctx, item.id, {
        title: chosen.title,
        dueDate: chosen.dueDate,
        reminder: chosen.reminder ?? undefined,
      }),
    );
    expect(created).toMatchObject({ title: "Ligar pro contador", dueDate: "2026-10-21", inboxItemId: item.id });
    expect(reminder).toMatchObject({
      taskId: created.id,
      title: "Ligar pro contador",
      dueAt: "2026-10-21T18:00:00.000Z",
      timezone: TZ,
      status: "pending",
    });
    expect(converted.status).toBe("converted");
  });

  it("tarefa e lembrete são gravados juntos: se o lembrete falhar, a tarefa também não fica", async () => {
    const core = await makeCore();
    const item = unwrap(await capture(core.ctx, { text: "Remédio" }));

    core.db.beforeStatement = (_i, s) => {
      if (s.sql.startsWith("INSERT INTO reminders")) throw new Error("falha simulada");
    };
    const result = await convertInboxToTask(core.ctx, item.id, { reminder: { dueAt: "2026-10-21T12:00:00Z", timezone: TZ } });
    core.db.beforeStatement = undefined;

    expectError(result, "storage_error");
    expect(await count(core, "tasks")).toBe(0);
    expect(await count(core, "reminders")).toBe(0);
    expect((await getInboxItem(core.ctx, item.id))?.status).toBe("open");
  });

  it("lembrete inválido impede a conversão inteira, com mensagem clara", async () => {
    const core = await makeCore();
    const item = unwrap(await capture(core.ctx, { text: "Algo" }));
    const result = await convertInboxToTask(core.ctx, item.id, { reminder: { dueAt: "amanhã", timezone: TZ } });
    expect(expectError(result, "validation_error").message).toMatch(/fuso/);
    expect(await count(core, "tasks")).toBe(0);
  });

  it("proposta para item já convertido é recusada", async () => {
    const { ctx } = await makeCore();
    const item = unwrap(await capture(ctx, { text: "x" }));
    unwrap(await convertInboxToTask(ctx, item.id));
    expectError(await proposeTaskFromInbox(ctx, item.id, { timeZone: TZ }), "invalid_state");
  });
});
