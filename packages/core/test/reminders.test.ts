import { describe, expect, it } from "vitest";
import {
  cancelReminder,
  createReminder,
  getReminder,
  listReminders,
  reminderHistory,
  rescheduleReminder,
} from "../src/domain/reminders";
import { createTask } from "../src/domain/tasks";
import { count, expectError, makeCore, unwrap } from "./support/setup";

const TZ = "America/Sao_Paulo";

describe("lembretes (persistência; o disparo é da etapa 4)", () => {
  it("salva o instante em UTC, guarda o fuso e nasce 'pending', não 'agendado'", async () => {
    const { ctx } = await makeCore();
    const r = unwrap(await createReminder(ctx, { title: "Ligar para o contador", dueAt: "2026-10-21T09:00:00-03:00", timezone: TZ }));
    expect(r).toMatchObject({ dueAt: "2026-10-21T12:00:00.000Z", timezone: TZ, status: "pending", firedAt: null });
  });

  it("exige fuso explícito no horário e fuso IANA válido", async () => {
    const { ctx } = await makeCore();
    expectError(await createReminder(ctx, { title: "x", dueAt: "2026-10-21T09:00:00", timezone: TZ }), "validation_error");
    expectError(await createReminder(ctx, { title: "x", dueAt: "2026-10-21T09:00:00Z", timezone: "Brasil/Tanto-faz" }), "validation_error");
  });

  it("pode ser ligado a uma tarefa existente; tarefa inexistente é recusada", async () => {
    const { ctx } = await makeCore();
    const t = unwrap(await createTask(ctx, { title: "Renovar domínio" }));
    unwrap(await createReminder(ctx, { title: "Renovar", dueAt: "2026-10-21T12:00:00Z", timezone: TZ, taskId: t.id }));
    expect((await listReminders(ctx, { taskId: t.id })).length).toBe(1);
    expectError(await createReminder(ctx, { title: "x", dueAt: "2026-10-21T12:00:00Z", timezone: TZ, taskId: "nao" }), "not_found");
  });

  it("mesma chave de idempotência não cria lembrete duplicado", async () => {
    const core = await makeCore();
    const input = { title: "Remédio", dueAt: "2026-10-21T12:00:00Z", timezone: TZ, idempotencyKey: "rem-000001" };
    unwrap(await createReminder(core.ctx, input));
    const again = await createReminder(core.ctx, input);
    expect(again.ok && again.duplicate).toBe(true);
    expect(await count(core, "reminders")).toBe(1);
  });

  it("reagendar troca o horário, volta a 'pending' e fica no histórico", async () => {
    const { ctx } = await makeCore();
    const r = unwrap(await createReminder(ctx, { title: "x", dueAt: "2026-10-21T12:00:00Z", timezone: TZ }));
    const moved = unwrap(await rescheduleReminder(ctx, r.id, { dueAt: "2026-10-22T08:30:00-03:00" }));
    expect(moved).toMatchObject({ dueAt: "2026-10-22T11:30:00.000Z", status: "pending", timezone: TZ });
    expect((await reminderHistory(ctx, r.id)).map((h) => h.action)).toEqual(["reminder.created", "reminder.rescheduled"]);
  });

  it("cancelar funciona, repetir não é erro, e cancelado não pode ser reagendado", async () => {
    const { ctx } = await makeCore();
    const r = unwrap(await createReminder(ctx, { title: "x", dueAt: "2026-10-21T12:00:00Z", timezone: TZ }));
    expect(unwrap(await cancelReminder(ctx, r.id)).status).toBe("cancelled");
    const again = await cancelReminder(ctx, r.id);
    expect(again.ok && again.duplicate).toBe(true);
    expectError(await rescheduleReminder(ctx, r.id, { dueAt: "2026-10-23T12:00:00Z" }), "invalid_state");
  });

  it("lembrete já disparado não pode ser cancelado", async () => {
    const core = await makeCore();
    const r = unwrap(await createReminder(core.ctx, { title: "x", dueAt: "2026-10-21T12:00:00Z", timezone: TZ }));
    await core.db.batch([{ sql: "UPDATE reminders SET status = 'fired' WHERE id = ?", params: [r.id] }]);
    expectError(await cancelReminder(core.ctx, r.id), "invalid_state");
    expect((await getReminder(core.ctx, r.id))?.status).toBe("fired");
  });
});
