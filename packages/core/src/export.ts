import { nowIso, type CoreContext } from "./context";
import { schemaVersion } from "./storage/migrate";

/** Tabelas com dados do usuário, na ordem em que podem ser reimportadas (pais antes de filhos). */
export const EXPORT_TABLES = [
  "categories",
  "inbox_items",
  "projects",
  "tasks",
  "decisions",
  "notes",
  "reminders",
  "audit_log",
] as const;

export interface SophiaExport {
  format: "sophia-local-export";
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<(typeof EXPORT_TABLES)[number], Record<string, unknown>[]>;
}

/** Exporta todos os dados do usuário em JSON, com as colunas exatamente como estão no banco. */
export async function exportAll(ctx: CoreContext): Promise<SophiaExport> {
  const entries = await Promise.all(
    EXPORT_TABLES.map(async (t) => [t, await ctx.db.select(`SELECT * FROM ${t} ORDER BY rowid`)] as const),
  );
  return {
    format: "sophia-local-export",
    formatVersion: 1,
    schemaVersion: await schemaVersion(ctx.db),
    exportedAt: nowIso(ctx),
    tables: Object.fromEntries(entries) as SophiaExport["tables"],
  };
}
