/**
 * Interpretador determinístico de datas e horários em português do Brasil.
 *
 * Não usa IA. Reconhece um conjunto fechado de expressões (ver
 * docs/05-expressoes-de-data.md) e devolve uma de quatro respostas:
 *
 * - none       nenhuma data no texto
 * - resolved   uma única leitura possível, com as suposições que fez
 * - ambiguous  mais de uma leitura razoável: a SOPHIA pergunta, não escolhe
 * - vague      período sem dia definido ("semana que vem"): nada é inventado
 *
 * Princípio: errar por omissão (não achar uma data) é preferível a errar por
 * invenção (marcar o dia errado). Na dúvida, não reconhece ou pergunta.
 */

import {
  addDays,
  compareDates,
  dateInZone,
  daysInMonth,
  formatDate,
  isValidCivilDate,
  timeInZone,
  weekday,
  zonedTimeToInstant,
  type CivilDate,
} from "../time/calendar";

export interface Moment {
  /** AAAA-MM-DD no fuso do usuário. */
  date: string;
  /** HH:MM no fuso do usuário, ou null quando só há dia. */
  time: string | null;
  /** Instante UTC (ISO) quando há horário; null caso contrário. */
  instant: string | null;
  /** Texto curto para mostrar, por exemplo "sex, 24/10 às 14:00". */
  label: string;
}

export type DateParse =
  | { kind: "none"; remainder: string }
  | { kind: "resolved"; moment: Moment; matched: string[]; assumptions: string[]; remainder: string }
  | { kind: "ambiguous"; question: string; options: Moment[]; matched: string[]; remainder: string }
  | { kind: "vague"; note: string; matched: string[]; remainder: string };

export interface ParseOptions {
  now: Date;
  timeZone: string;
}

interface Clock {
  hour: number;
  minute: number;
}

interface Candidate {
  date: CivilDate;
  /** Presente quando a própria expressão já define o instante ("daqui a 30 minutos"). */
  instant?: Date;
}

interface Hit {
  start: number;
  end: number;
}

interface DateHit extends Hit {
  kind: "date";
  options: Candidate[];
  assumption?: string;
  weekdayTarget?: number;
}

interface VagueHit extends Hit {
  kind: "vague";
  nextWeek: boolean;
}

interface TimeHit extends Hit {
  options: Clock[];
}

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  quinze: 15,
  vinte: 20,
  trinta: 30,
};
const NUM = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")}`;
const toNumber = (s: string) => NUMBER_WORDS[s] ?? Number(s);

/** Conectores que acompanham a data e saem do título junto com ela: "até sexta", "para o dia 25". */
const PREFIX = String.raw`((?:ate|para|pra|na|no|em)\s+(?:o\s+|a\s+)?)?`;
const PERIOD = String.raw`(?:\s+(da manha|da tarde|da noite|da madrugada))?`;
/** Horas precedidas destas palavras são duração ("reunião de 2h"), não horário. */
const NOT_DURATION = String.raw`(?<!\b(?:de|por|durante|dura|leva|levar)\s)`;
/** Palavras que sobram no fim do título depois de tirar a data ("pagar até" → "pagar"). */
const TRAILING_CONNECTORS = new Set(["e", "ate", "para", "pra", "no", "na", "em", "de", "do", "da", "as", "a", "o", "dia"]);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Minúsculas e sem acento, preservando o comprimento (as posições valem para o texto original). */
function fold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += ((text[i] as string).normalize("NFD")[0] ?? " ").toLowerCase();
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

function overlaps(a: Hit, taken: readonly Hit[]): boolean {
  return taken.some((b) => a.start < b.end && b.start < a.end);
}

function applyPeriod(hour: number, period: string | undefined): number | null {
  if (period === undefined) return hour;
  if (hour > 12) return null;
  switch (period) {
    case "da tarde":
      return hour === 12 ? 12 : hour + 12;
    case "da noite":
      return hour === 12 ? 0 : hour < 6 ? hour : hour + 12;
    default: // da manhã, da madrugada
      return hour === 12 ? 0 : hour;
  }
}

function shortDate(d: CivilDate, today: CivilDate): string {
  const base = `${WEEKDAY_SHORT[weekday(d)]}, ${pad(d.day)}/${pad(d.month)}`;
  return d.year === today.year ? base : `${base}/${d.year}`;
}

/** Palavras que, logo antes de um número, indicam que ele é uma data ("prazo 25/10"). */
const DATE_LEAD_WORDS = /(?:^|\s)(?:prazo|vence|vencimento|entrega|entregar|data|ate|dia)\s*:?\s*$/;

/**
 * O trecho reconhecido tem contexto claro de data? Usado onde a mesma forma
 * também é comum fora de datas: "1/2 xícara", "nota 10/10", "segunda versão".
 */
function hasDateContext(f: string, base: Hit, hadPrefix: boolean): boolean {
  if (hadPrefix || DATE_LEAD_WORDS.test(f.slice(0, base.start))) return true;
  const next = f.slice(base.end).trimStart();
  return (
    next === "" ||
    /^[,.;:!?)]/.test(next) ||
    /^as\s+\d/.test(next) ||
    /^(?:ou|e)\s+(?:\d{1,2}\/\d{1,2}|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(next)
  );
}

// ---------------------------------------------------------------------------
// Reconhecedores de data
// ---------------------------------------------------------------------------

function findDates(f: string, now: Date, today: CivilDate, timeZone: string): Array<DateHit | VagueHit> {
  const hits: Array<DateHit | VagueHit> = [];
  const scan = (re: RegExp, build: (m: RegExpMatchArray, base: Hit) => DateHit | VagueHit | null) => {
    for (const m of f.matchAll(re)) {
      const start = m.index ?? 0;
      const base = { start, end: start + m[0].length };
      if (overlaps(base, hits)) continue;
      const hit = build(m, base);
      if (hit) hits.push(hit);
    }
  };

  // Horário relativo: "daqui a 30 minutos", "em 2 horas", "daqui a meia hora".
  scan(new RegExp(String.raw`\b(?:daqui a|em|dentro de)\s+(${NUM}|meia)\s+(minutos?|min|horas?)\b`, "g"), (m, base) => {
    const isHours = (m[2] as string).startsWith("h");
    if (m[1] === "meia" && !isHours) return null;
    const amount = m[1] === "meia" ? 0.5 : toNumber(m[1] as string);
    const instant = new Date(now.getTime() + amount * (isHours ? 60 : 1) * 60_000);
    return { ...base, kind: "date", options: [{ date: dateInZone(instant, timeZone), instant }] };
  });

  // Períodos vagos: não viram data.
  scan(/\b(semana que vem|proxima semana|mes que vem|proximo mes|fim de semana|final de semana|em breve|qualquer dia|um dia desses)\b/g, (m, base) => ({
    ...base,
    kind: "vague",
    nextWeek: m[1] === "semana que vem" || m[1] === "proxima semana",
  }));

  // Fim do mês: último dia do mês corrente.
  scan(new RegExp(String.raw`\b${PREFIX}(?:fim|final) do mes\b`, "g"), (_m, base) => ({
    ...base,
    kind: "date",
    options: [{ date: { ...today, day: daysInMonth(today.year, today.month) } }],
  }));

  // dd/mm e dd/mm/aaaa.
  scan(new RegExp(String.raw`\b${PREFIX}(dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b`, "g"), (m, base) => {
    const [, prefix, dia, day, month, year] = m;
    if (year === undefined && !hasDateContext(f, base, prefix !== undefined || dia !== undefined)) return null;
    return explicitDate(base, today, Number(day), Number(month), year);
  });

  // "25 de outubro", "dia 2 de março de 2027".
  scan(
    new RegExp(String.raw`\b${PREFIX}(?:dia\s+)?(\d{1,2})\s+de\s+(${Object.keys(MONTHS).join("|")})(?:\s+de\s+(\d{4}))?\b`, "g"),
    (m, base) => explicitDate(base, today, Number(m[2]), MONTHS[m[3] as string] as number, m[4]),
  );

  // "dia 25": este mês, ou o próximo se já passou.
  scan(new RegExp(String.raw`\b${PREFIX}dia\s+(\d{1,2})\b`, "g"), (m, base) => dayOfMonth(base, today, Number(m[2])));

  // "daqui a 3 dias", "em duas semanas".
  scan(new RegExp(String.raw`\b(?:daqui a|em|dentro de)\s+(${NUM})\s+(dias?|semanas?)\b`, "g"), (m, base) => {
    const n = toNumber(m[1] as string);
    const days = (m[2] as string).startsWith("semana") ? n * 7 : n;
    return { ...base, kind: "date", options: [{ date: addDays(today, days) }] };
  });

  // hoje, amanhã, depois de amanhã.
  scan(new RegExp(String.raw`\b${PREFIX}(depois de amanha|amanha|hoje)\b(?!\s+em\s+dia)`, "g"), (m, base) => {
    const offset = m[2] === "hoje" ? 0 : m[2] === "amanha" ? 1 : 2;
    return { ...base, kind: "date", options: [{ date: addDays(today, offset) }] };
  });

  // Dias da semana, com "próxima", "nesta" ou "que vem".
  scan(
    new RegExp(
      String.raw`\b${PREFIX}(?:(proxim[ao]|nest[ae]|est[ae]|ess[ae])\s+)?(${Object.keys(WEEKDAYS).join("|")})(-feira|\s+feira)?(\s+que\s+vem)?\b`,
      "g",
    ),
    (m, base) => {
      const [, prefix, qualifier, name, feira, queVem] = m;
      // "segunda", "quarta", "quinta" e "sexta" também são ordinais ("segunda versão").
      // Sem contexto que indique dia da semana, não reconhecemos.
      const clearContext =
        hasDateContext(f, base, prefix !== undefined || qualifier !== undefined) ||
        feira !== undefined ||
        queVem !== undefined ||
        name === "sabado" ||
        name === "domingo";
      if (!clearContext) return null;

      const target = WEEKDAYS[name as string] as number;
      const diff = (target - weekday(today) + 7) % 7;
      const upcoming = addDays(today, diff);
      const isNext = qualifier?.startsWith("proxim") || queVem !== undefined;
      let dates: CivilDate[];
      if (isNext) dates = diff === 0 ? [addDays(today, 7)] : [upcoming, addDays(upcoming, 7)];
      else dates = diff === 0 ? [today, addDays(today, 7)] : [upcoming];
      return { ...base, kind: "date", options: dates.map((date) => ({ date })), weekdayTarget: target };
    },
  );

  return hits;
}

function explicitDate(base: Hit, today: CivilDate, day: number, month: number, yearText: string | undefined): DateHit | null {
  if (yearText !== undefined) {
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    const date = { year, month, day };
    if (!isValidCivilDate(date) || year < 2000 || year > 2100) return null;
    const past = compareDates(date, today) < 0;
    return { ...base, kind: "date", options: [{ date }], assumption: past ? "Atenção: essa data já passou." : undefined };
  }
  const thisYear = { year: today.year, month, day };
  if (isValidCivilDate(thisYear) && compareDates(thisYear, today) >= 0) return { ...base, kind: "date", options: [{ date: thisYear }] };
  for (let year = today.year + 1; year <= today.year + 4; year++) {
    const date = { year, month, day };
    if (isValidCivilDate(date)) {
      return {
        ...base,
        kind: "date",
        options: [{ date }],
        assumption: `Considerei ${pad(day)}/${pad(month)}/${year}, porque essa data já passou este ano.`,
      };
    }
  }
  return null;
}

function dayOfMonth(base: Hit, today: CivilDate, day: number): DateHit | null {
  if (day < 1 || day > 31) return null;
  let { year, month } = today;
  const reasons: string[] = [];
  if (day < today.day) {
    month += 1;
    reasons.push(`o dia ${day} deste mês já passou`);
  }
  for (;;) {
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (day <= daysInMonth(year, month)) break;
    reasons.push(`o mês ${pad(month)} não tem dia ${day}`);
    month += 1;
  }
  return {
    ...base,
    kind: "date",
    options: [{ date: { year, month, day } }],
    assumption: reasons.length ? `Considerei ${pad(day)}/${pad(month)}, porque ${reasons.join(" e ")}.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reconhecedores de horário
// ---------------------------------------------------------------------------

function findTimes(text: string, f: string, taken: readonly Hit[]): TimeHit[] {
  const hits: TimeHit[] = [];
  const scan = (re: RegExp, build: (m: RegExpMatchArray, hit: Hit) => Clock[] | null) => {
    for (const m of f.matchAll(re)) {
      const start = m.index ?? 0;
      const hit = { start, end: start + m[0].length };
      if (overlaps(hit, taken) || overlaps(hit, hits)) continue;
      const options = build(m, hit);
      if (options?.length) hits.push({ ...hit, options });
    }
  };

  scan(/\b(?:ao\s+|as\s+|a\s+)?(meio-dia|meio dia|meia-noite|meia noite)\b/g, (m) => [
    { hour: (m[1] as string).startsWith("meio") ? 12 : 0, minute: 0 },
  ]);

  // "14h", "14h30", "às 9h", "3h da tarde": o "h" indica relógio de 24 horas.
  scan(new RegExp(String.raw`${NOT_DURATION}\b(?:as\s+)?(\d{1,2})h(\d{2})?(?:min)?${PERIOD}\b`, "g"), (m) => clock(m[1], m[2], m[3]));

  // "14:30", "às 9:15".
  scan(new RegExp(String.raw`${NOT_DURATION}\b(?:as\s+)?(\d{1,2}):(\d{2})${PERIOD}\b`, "g"), (m) => clock(m[1], m[2], m[3]));

  // "3 da tarde", "às 9 horas da manhã".
  scan(/\b(?:as\s+)?(\d{1,2})\s+(?:horas?\s+)?(da manha|da tarde|da noite|da madrugada)\b/g, (m) => clock(m[1], undefined, m[2]));

  // "às 9", "às 15 horas": sem "h", de 1 a 11 pode ser manhã ou tarde/noite.
  // "as" sem acento também é artigo ("as 3 ideias"): aí só vale com "horas" ou no fim da frase.
  scan(/\bas\s+(\d{1,2})(\s+horas?)?\b/g, (m, hit) => {
    const accented = text.slice(hit.start, hit.start + 2).toLowerCase() === "às";
    const next = f.slice(hit.end).trimStart();
    if (!accented && m[2] === undefined && !(next === "" || /^[,.;:!?)]/.test(next))) return null;
    const hour = Number(m[1]);
    if (hour > 23) return null;
    if (hour >= 1 && hour <= 11) return [{ hour, minute: 0 }, { hour: hour + 12, minute: 0 }];
    return [{ hour, minute: 0 }];
  });

  return hits;
}

function clock(h: string | undefined, min: string | undefined, period: string | undefined): Clock[] | null {
  const hour = applyPeriod(Number(h), period);
  const minute = min === undefined ? 0 : Number(min);
  if (hour === null || hour > 23 || minute > 59) return null;
  return [{ hour, minute }];
}

// ---------------------------------------------------------------------------
// Combinação
// ---------------------------------------------------------------------------

function removeHits(text: string, hits: readonly Hit[]): string {
  let out = text;
  for (const h of [...hits].sort((a, b) => b.start - a.start)) out = `${out.slice(0, h.start)} ${out.slice(h.end)}`;
  out = out.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // Tira pontuação e conectores que ficaram soltos no fim ("pagar até" → "pagar").
  for (;;) {
    const trimmed = out.replace(/[\s,;:.\-–]+$/u, "");
    const lastWord = trimmed.match(/(\S+)$/u)?.[1];
    if (lastWord && TRAILING_CONNECTORS.has(fold(lastWord))) {
      out = trimmed.slice(0, trimmed.length - lastWord.length);
      continue;
    }
    out = trimmed;
    break;
  }
  return out.replace(/^[\s,;:\-–]+/u, "").trim();
}

export function parseDateExpression(text: string, options: ParseOptions): DateParse {
  const { now, timeZone } = options;
  const today = dateInZone(now, timeZone);
  const f = fold(text);

  const found = findDates(f, now, today, timeZone);
  const dateHits = found.filter((h): h is DateHit => h.kind === "date");
  const vagueHits = found.filter((h): h is VagueHit => h.kind === "vague");
  const timeHits = findTimes(text, f, found);
  const allHits: Hit[] = [...found, ...timeHits].sort((a, b) => a.start - b.start);
  const matched = allHits.map((h) => text.slice(h.start, h.end).trim());
  const remainder = removeHits(text, allHits) || text.trim();

  if (allHits.length === 0) return { kind: "none", remainder: text.trim() };

  if (dateHits.length === 0 && vagueHits.length > 0) {
    return {
      kind: "vague",
      note: `"${matched.join(" ")}" não define um dia. Guardei sem prazo; a data pode ser escolhida depois.`,
      matched,
      remainder,
    };
  }

  const assumptions: string[] = [];

  // "semana que vem" + dia da semana = aquele dia na semana seguinte (semana começando na segunda).
  if (vagueHits.some((v) => v.nextWeek) && dateHits.some((h) => h.weekdayTarget !== undefined)) {
    const mondayNextWeek = addDays(today, (8 - weekday(today)) % 7 || 7);
    for (const h of dateHits) {
      if (h.weekdayTarget !== undefined) h.options = [{ date: addDays(mondayNextWeek, (h.weekdayTarget + 6) % 7) }];
    }
  } else if (vagueHits.length > 0) {
    const vagueText = vagueHits.map((v) => `"${text.slice(v.start, v.end).trim()}"`).join(", ");
    assumptions.push(`Usei a data exata e ignorei ${vagueText}.`);
  }

  let candidates: Candidate[] = [];
  for (const h of dateHits) {
    if (h.assumption) assumptions.push(h.assumption);
    candidates.push(...h.options);
  }

  const clocks = timeHits
    .flatMap((t) => t.options)
    .filter((t, i, all) => all.findIndex((x) => x.hour === t.hour && x.minute === t.minute) === i);

  if (candidates.length === 0) {
    // Só horário: hoje, se ainda não passou; senão amanhã, e isso fica dito.
    const allAhead = clocks.every((c) => zonedTimeToInstant(today, c.hour, c.minute, timeZone) > now);
    candidates = [{ date: allAhead ? today : addDays(today, 1) }];
    if (!allAhead) assumptions.push("Esse horário de hoje já passou, então considerei amanhã.");
  }

  const moments: Moment[] = [];
  for (const c of candidates) {
    const options: Array<Clock | null> = c.instant ? [timeInZone(c.instant, timeZone)] : clocks.length ? clocks : [null];
    for (const t of options) {
      const instant = t ? (c.instant ?? zonedTimeToInstant(c.date, t.hour, t.minute, timeZone)) : null;
      const time = t ? `${pad(t.hour)}:${pad(t.minute)}` : null;
      const moment: Moment = {
        date: formatDate(c.date),
        time,
        instant: instant ? instant.toISOString() : null,
        label: `${shortDate(c.date, today)}${time ? ` às ${time}` : ""}`,
      };
      if (!moments.some((m) => m.date === moment.date && m.time === moment.time)) moments.push(moment);
    }
  }

  if (moments.length === 1) {
    return { kind: "resolved", moment: moments[0] as Moment, matched, assumptions, remainder };
  }
  const differentDates = new Set(moments.map((m) => m.date)).size > 1;
  const differentTimes = new Set(moments.map((m) => m.time)).size > 1;
  const question =
    differentDates && differentTimes ? "Qual destas opções?" : differentDates ? "Qual destas datas?" : "Qual destes horários?";
  return { kind: "ambiguous", question, options: moments, matched, remainder };
}
