/**
 * Proposta de tarefa a partir de texto livre, sem IA.
 *
 * A proposta NÃO é gravada. Ela mostra ao usuário o que a SOPHIA entendeu
 * (título, prazo, lembrete, suposições) e, se a data for ambígua, a pergunta
 * a fazer. A gravação acontece em `convertInboxToTask`, com o que foi confirmado.
 */

import type { CoreContext } from "../context";
import { deriveTitle, getInboxItem } from "../domain/inbox";
import { fail, ok, type Result } from "../result";
import { parseDateExpression, type DateParse, type Moment } from "../parsing/dates-ptbr";

export interface TaskProposal {
  title: string;
  description: string | null;
  /** Prazo (AAAA-MM-DD) quando a data foi entendida sem ambiguidade. */
  dueDate: string | null;
  /** Lembrete sugerido quando o texto traz um horário. */
  reminder: { dueAt: string; timezone: string } | null;
  dates: DateParse;
  /** Há uma escolha pendente: perguntar antes de gravar com prazo. */
  needsClarification: boolean;
  /** O que foi suposto ou não entendido, para mostrar ao usuário. */
  notes: string[];
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
}

export function proposeTask(text: string, options: { now: Date; timeZone: string }): TaskProposal {
  const dates = parseDateExpression(text, options);
  const title = capitalize(deriveTitle(dates.remainder));
  const base = {
    title,
    description: text.trim() === title ? null : text.trim(),
    dueDate: null,
    reminder: null,
    dates,
    needsClarification: false,
    notes: [] as string[],
  };
  switch (dates.kind) {
    case "none":
      return base;
    case "vague":
      return { ...base, notes: [dates.note] };
    case "ambiguous":
      return { ...base, needsClarification: true, notes: [dates.question] };
    case "resolved":
      return { ...withMoment(base, dates.moment, options.timeZone), notes: dates.assumptions };
  }
}

/** Aplica a opção escolhida pelo usuário a uma proposta ambígua. */
export function chooseOption(proposal: TaskProposal, index: number, timeZone: string): Result<TaskProposal> {
  if (proposal.dates.kind !== "ambiguous") {
    return fail("invalid_state", "Esta proposta não tem opções para escolher.");
  }
  const { options, matched, remainder } = proposal.dates;
  const moment = options[index];
  if (!moment) return fail("validation_error", "Opção inexistente.", { index });
  return ok({
    ...withMoment(proposal, moment, timeZone),
    dates: { kind: "resolved", moment, matched, assumptions: [], remainder },
    needsClarification: false,
    notes: [],
  });
}

function withMoment(p: TaskProposal, moment: Moment, timeZone: string): TaskProposal {
  return {
    ...p,
    dueDate: moment.date,
    reminder: moment.instant ? { dueAt: moment.instant, timezone: timeZone } : null,
  };
}

/** Proposta para um item aberto da Inbox, usando o relógio do núcleo. */
export async function proposeTaskFromInbox(
  ctx: CoreContext,
  itemId: string,
  options: { timeZone: string },
): Promise<Result<TaskProposal>> {
  const item = await getInboxItem(ctx, itemId);
  if (!item) return fail("not_found", "Item da Inbox não encontrado.", { id: itemId });
  if (item.status !== "open") return fail("invalid_state", "Este item já foi convertido ou arquivado.", { status: item.status });
  return ok(proposeTask(item.text, { now: ctx.clock.now(), timeZone: options.timeZone }));
}
