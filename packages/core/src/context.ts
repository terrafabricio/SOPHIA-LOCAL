import type { SqlDriver } from "./storage/driver";

/** Relógio injetável: permite testar prazos e lembretes sem depender da hora real. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type IdGenerator = () => string;

export const randomId: IdGenerator = () => crypto.randomUUID();

/** Dependências compartilhadas por todos os serviços do núcleo. */
export interface CoreContext {
  db: SqlDriver;
  clock: Clock;
  newId: IdGenerator;
}

export function createContext(db: SqlDriver, overrides: Partial<Omit<CoreContext, "db">> = {}): CoreContext {
  return { db, clock: overrides.clock ?? systemClock, newId: overrides.newId ?? randomId };
}

export function nowIso(ctx: CoreContext): string {
  return ctx.clock.now().toISOString();
}
