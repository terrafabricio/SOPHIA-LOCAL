/**
 * Datas civis (AAAA-MM-DD) e conversão para instantes num fuso IANA,
 * usando só a API Intl. A aritmética de dias acontece em UTC, onde não
 * existe horário de verão, e só no fim é convertida para o fuso do usuário.
 */

export interface CivilDate {
  year: number;
  month: number; // 1–12
  day: number;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

export function formatDate(d: CivilDate): string {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}

export function parseDate(iso: string): CivilDate {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y as number, month: m as number, day: d as number };
}

export function isValidCivilDate(d: CivilDate): boolean {
  if (d.month < 1 || d.month > 12 || d.day < 1) return false;
  return d.day <= daysInMonth(d.year, d.month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(d: CivilDate, days: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = domingo … 6 = sábado. */
export function weekday(d: CivilDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return formatDate(a).localeCompare(formatDate(b));
}

interface ZonedParts extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Data civil de um instante no fuso indicado (por exemplo, "hoje" para o usuário). */
export function dateInZone(instant: Date, timeZone: string): CivilDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

/** Hora e minuto de um instante no fuso indicado. */
export function timeInZone(instant: Date, timeZone: string): { hour: number; minute: number } {
  const { hour, minute } = zonedParts(instant, timeZone);
  return { hour, minute };
}

/** Deslocamento do fuso (em ms) naquele instante: hora local − UTC. */
function offsetAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converte data + hora locais de um fuso num instante UTC.
 * Num horário que não existe (pulo do horário de verão), avança para o primeiro horário válido.
 */
export function zonedTimeToInstant(date: CivilDate, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = wall - offsetAt(new Date(wall), timeZone);
  const second = wall - offsetAt(new Date(first), timeZone);
  const matchesWall = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
  };
  if (matchesWall(second)) return new Date(second);
  if (matchesWall(first)) return new Date(first);
  // Horário inexistente (pulo do horário de verão): o mais tardio dos dois cai logo depois do pulo.
  return new Date(Math.max(first, second));
}
