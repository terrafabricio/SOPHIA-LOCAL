import { describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION, migrate, schemaVersion } from "../src/storage/migrate";
import { openNodeSqlite } from "./support/node-sqlite-driver";

describe("migrações", () => {
  it("aplica o schema num banco novo e registra a versão", async () => {
    const db = openNodeSqlite();
    expect(await migrate(db)).toEqual([1]);
    expect(await schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it("é idempotente: rodar de novo não reaplica nada", async () => {
    const db = openNodeSqlite();
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
  });

  it("cria as 8 categorias iniciais da especificação, em ordem", async () => {
    const db = openNodeSqlite();
    await migrate(db);
    const rows = await db.select<{ name: string }>("SELECT name FROM categories ORDER BY position");
    expect(rows.map((r) => r.name)).toEqual([
      "Livro de Tawa",
      "SOPHIA, Edith e aplicativos",
      "Asymmetrika e negócios",
      "Carreira e trabalho",
      "Conteúdo, YouTube e newsletter",
      "Estudos e inglês",
      "Vida pessoal e rotina",
      "Ideias avulsas",
    ]);
  });

  it("recusa abrir um banco criado por uma versão mais nova do app", async () => {
    const db = openNodeSqlite();
    await migrate(db);
    await db.batch([{ sql: "INSERT INTO schema_migrations VALUES (999, 'futuro', '2030-01-01T00:00:00Z')" }]);
    await expect(migrate(db)).rejects.toThrow(/versão 999/);
  });

  it("migração com erro não deixa schema pela metade", async () => {
    const db = openNodeSqlite();
    const broken = { version: 1, name: "quebrada", statements: ["CREATE TABLE a (x)", "ISTO NÃO É SQL"] };
    await expect(migrate(db, [broken])).rejects.toThrow();
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'a'")).toEqual([]);
    expect(await schemaVersion(db)).toBe(0);
  });
});
