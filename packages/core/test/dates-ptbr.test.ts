import { describe, expect, it } from "vitest";
import { parseDateExpression, type DateParse } from "../src/parsing/dates-ptbr";
import { zonedTimeToInstant } from "../src/time/calendar";

const TZ = "America/Sao_Paulo";
/** Terça-feira, 20/10/2026, 09:00 em São Paulo. */
const NOW = new Date("2026-10-20T12:00:00Z");

const parse = (text: string, now = NOW, timeZone = TZ) => parseDateExpression(text, { now, timeZone });

function resolved(r: DateParse) {
  if (r.kind !== "resolved") throw new Error(`Esperava 'resolved', veio '${r.kind}': ${JSON.stringify(r)}`);
  return r;
}
function ambiguous(r: DateParse) {
  if (r.kind !== "ambiguous") throw new Error(`Esperava 'ambiguous', veio '${r.kind}': ${JSON.stringify(r)}`);
  return r;
}

describe("datas relativas", () => {
  it.each([
    ["Pagar conta hoje", "2026-10-20"],
    ["Preciso resolver o domínio da empresa amanhã.", "2026-10-21"],
    ["depois de amanhã: dentista", "2026-10-22"],
    ["daqui a 3 dias", "2026-10-23"],
    ["em duas semanas", "2026-11-03"],
    ["até o fim do mês", "2026-10-31"],
  ])("%s → %s", (text, date) => {
    expect(resolved(parse(text)).moment).toMatchObject({ date, time: null, instant: null });
  });

  it("'hoje' e 'amanhã' seguem o fuso do usuário, não o UTC", () => {
    // 16:00 UTC = 01:00 do dia 21 em Tóquio.
    expect(resolved(parse("amanhã", new Date("2026-10-20T16:00:00Z"), "Asia/Tokyo")).moment.date).toBe("2026-10-22");
  });
});

describe("dias da semana", () => {
  it.each([
    ["Entregar relatório sexta", "2026-10-23"],
    ["na sexta", "2026-10-23"],
    ["até sexta-feira", "2026-10-23"],
    ["no sábado", "2026-10-24"],
    ["domingo tem almoço", "2026-10-25"],
    ["próxima terça", "2026-10-27"],
    ["semana que vem na quarta", "2026-10-28"],
    ["Sexta: revisar capítulo", "2026-10-23"],
  ])("%s → %s", (text, date) => {
    expect(resolved(parse(text)).moment.date).toBe(date);
  });

  it("[cenário 9] 'próxima sexta' pode ser esta ou a seguinte: pergunta", () => {
    const r = ambiguous(parse("próxima sexta"));
    expect(r.question).toBe("Qual destas datas?");
    expect(r.options.map((o) => o.label)).toEqual(["sex, 23/10", "sex, 30/10"]);
  });

  it("[cenário 9] 'terça' dito numa terça pode ser hoje ou daqui a 7 dias: pergunta", () => {
    expect(ambiguous(parse("reunião na terça")).options.map((o) => o.date)).toEqual(["2026-10-20", "2026-10-27"]);
  });

  it.each([
    "1/2 xícara de açúcar",
    "nota 10/10 pro filme",
    "as 3 ideias principais",
    "hoje em dia tudo é IA",
    "comprar 2 kg de café",
    "lançar versão 2.0",
    "meta para 2027",
    "rotina do dia a dia",
    "em 3 passos",
    "leva 2h pra fazer",
  ])("falso positivo evitado: %s", (text) => {
    expect(parse(text).kind).toBe("none");
  });

  it.each([
    ["prazo 25/10 para o cliente", "2026-10-25"],
    ["Entregar relatório 25/10", "2026-10-25"],
    ["vence 5/11, não esquecer", "2026-11-05"],
  ])("dd/mm com contexto de data: %s → %s", (text, date) => {
    expect(resolved(parse(text)).moment.date).toBe(date);
  });

  it("'as 3' sem acento no fim da frase ainda é horário (pergunta qual)", () => {
    expect(ambiguous(parse("ligar amanhã as 3")).options.map((o) => o.time)).toEqual(["03:00", "15:00"]);
  });

  it("ordinais não viram dia da semana", () => {
    expect(parse("terminar a segunda versão do site").kind).toBe("none");
    expect(parse("a quinta parte do livro").kind).toBe("none");
  });

  it("duas datas diferentes no mesmo texto: pergunta", () => {
    expect(ambiguous(parse("sexta ou sábado")).options.map((o) => o.date)).toEqual(["2026-10-23", "2026-10-24"]);
  });
});

describe("datas do calendário", () => {
  it.each([
    ["dia 25", "2026-10-25"],
    ["para o dia 25", "2026-10-25"],
    ["25/12", "2026-12-25"],
    ["25 de outubro de 2026", "2026-10-25"],
    ["vence 30/11/26", "2026-11-30"],
  ])("%s → %s", (text, date) => {
    const r = resolved(parse(text));
    expect(r.moment.date).toBe(date);
    expect(r.assumptions).toEqual([]);
  });

  it("dia que já passou neste mês vai para o próximo, e isso é dito", () => {
    const r = resolved(parse("dia 5"));
    expect(r.moment.date).toBe("2026-11-05");
    expect(r.assumptions[0]).toMatch(/já passou/);
  });

  it("dia inexistente no mês avança e explica", () => {
    const r = resolved(parse("dia 31", new Date("2026-11-05T12:00:00Z")));
    expect(r.moment.date).toBe("2026-12-31");
    expect(r.assumptions[0]).toMatch(/não tem dia 31/);
  });

  it("data sem ano que já passou vai para o ano seguinte, e isso é dito", () => {
    for (const text of ["10/01", "2 de março"]) {
      const r = resolved(parse(text));
      expect(r.moment.date.startsWith("2027-")).toBe(true);
      expect(r.assumptions[0]).toMatch(/já passou/);
    }
  });

  it("data explícita no passado é aceita, mas com aviso", () => {
    const r = resolved(parse("15/03/2025"));
    expect(r.moment.date).toBe("2025-03-15");
    expect(r.assumptions).toEqual(["Atenção: essa data já passou."]);
  });

  it("datas impossíveis não são reconhecidas", () => {
    expect(parse("31/02").kind).toBe("none");
    expect(parse("dia 40").kind).toBe("none");
  });
});

describe("horários", () => {
  it.each([
    ["amanhã às 14h", "2026-10-21", "14:00", "2026-10-21T17:00:00.000Z"],
    ["amanhã 14h30", "2026-10-21", "14:30", "2026-10-21T17:30:00.000Z"],
    ["amanhã às 9:15", "2026-10-21", "09:15", "2026-10-21T12:15:00.000Z"],
    ["amanhã às 3 da tarde", "2026-10-21", "15:00", "2026-10-21T18:00:00.000Z"],
    ["sexta às 8 da noite", "2026-10-23", "20:00", "2026-10-23T23:00:00.000Z"],
    ["amanhã ao meio-dia", "2026-10-21", "12:00", "2026-10-21T15:00:00.000Z"],
    ["às 15", "2026-10-20", "15:00", "2026-10-20T18:00:00.000Z"],
    ["daqui a 30 minutos", "2026-10-20", "09:30", "2026-10-20T12:30:00.000Z"],
    ["em 2 horas", "2026-10-20", "11:00", "2026-10-20T14:00:00.000Z"],
    ["daqui a meia hora", "2026-10-20", "09:30", "2026-10-20T12:30:00.000Z"],
  ])("%s → %s %s", (text, date, time, instant) => {
    expect(resolved(parse(text)).moment).toMatchObject({ date, time, instant });
  });

  it("[cenário 9] 'às 3' sem período pode ser madrugada ou tarde: pergunta", () => {
    const r = ambiguous(parse("ligar pro contador amanhã às 3"));
    expect(r.question).toBe("Qual destes horários?");
    expect(r.options.map((o) => o.label)).toEqual(["qua, 21/10 às 03:00", "qua, 21/10 às 15:00"]);
  });

  it("só horário, já passado hoje: considera amanhã e diz isso", () => {
    const r = resolved(parse("às 8h"));
    expect(r.moment).toMatchObject({ date: "2026-10-21", time: "08:00" });
    expect(r.assumptions).toEqual(["Esse horário de hoje já passou, então considerei amanhã."]);
  });

  it("duração não é confundida com horário", () => {
    const r = resolved(parse("reunião de 2h amanhã"));
    expect(r.moment).toMatchObject({ date: "2026-10-21", time: null });
    expect(r.remainder).toBe("reunião de 2h");
  });
});

describe("períodos vagos", () => {
  it("[cenário 9] 'semana que vem' não inventa um dia", () => {
    const r = parse("organizar a garagem semana que vem");
    expect(r.kind).toBe("vague");
    expect(r.remainder).toBe("organizar a garagem");
  });

  it("período vago com horário continua vago", () => {
    expect(parse("semana que vem às 14h").kind).toBe("vague");
  });

  it("texto sem data devolve 'none' e o texto intacto", () => {
    expect(parse("Comprar café")).toEqual({ kind: "none", remainder: "Comprar café" });
  });
});

describe("título sem a data", () => {
  it.each([
    ["Preciso resolver o domínio da empresa amanhã.", "Preciso resolver o domínio da empresa"],
    ["Pagar o boleto até sexta", "Pagar o boleto"],
    ["Ligar para o contador amanhã às 14h", "Ligar para o contador"],
    ["Amanhã: ligar para o banco", "ligar para o banco"],
    ["Entregar proposta para o dia 25, sem falta", "Entregar proposta, sem falta"],
  ])("%s → %s", (text, remainder) => {
    expect(parse(text).remainder).toBe(remainder);
  });
});

describe("fuso horário", () => {
  it("converte hora local em instante UTC", () => {
    expect(zonedTimeToInstant({ year: 2026, month: 10, day: 21 }, 14, 0, TZ).toISOString()).toBe("2026-10-21T17:00:00.000Z");
  });

  it("horário inexistente no pulo do horário de verão avança para depois do pulo", () => {
    // Nova York, 08/03/2026: 02:00 vira 03:00. 02:30 não existe → 03:30 EDT = 07:30 UTC.
    expect(zonedTimeToInstant({ year: 2026, month: 3, day: 8 }, 2, 30, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("horário comum em dia de mudança de horário converte certo", () => {
    expect(zonedTimeToInstant({ year: 2026, month: 3, day: 8 }, 10, 0, "America/New_York").toISOString()).toBe(
      "2026-03-08T14:00:00.000Z",
    );
  });
});
