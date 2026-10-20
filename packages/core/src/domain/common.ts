import { z } from "zod";
import type { CoreContext } from "../context";
import { fail, type Result } from "../result";

z.config(z.locales.pt());

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const prioritySchema = z.enum(PRIORITIES);
export const idSchema = z.string().min(1, { error: "Identificador vazio." });
/** Data sem hora (AAAA-MM-DD), usada para prazos. */
export const dateOnlySchema = z.iso.date({ error: "Data inválida. Use AAAA-MM-DD." });
/** Instante com fuso explícito (Z ou ±hh:mm). */
export const instantSchema = z.iso.datetime({ offset: true, error: "Data e hora inválidas. Inclua o fuso horário." });
export const idempotencyKeySchema = z.string().min(8).max(200).optional();

export function requiredText(label: string, max: number) {
  return z
    .string({ error: `${label} é obrigatório.` })
    .trim()
    .min(1, { error: `${label} não pode ficar vazio.` })
    .max(max, { error: `${label} passou do limite de ${max} caracteres.` });
}

export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `Texto passou do limite de ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): Result<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return fail(
    "validation_error",
    parsed.error.issues.map((i) => i.message).join(" "),
    parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/** Normaliza texto para comparar duplicatas: sem acento, minúsculo, espaços colapsados. */
export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function exists(ctx: CoreContext, table: string, id: string): Promise<boolean> {
  const rows = await ctx.db.select(`SELECT 1 AS found FROM ${table} WHERE id = ?`, [id]);
  return rows.length > 0;
}
