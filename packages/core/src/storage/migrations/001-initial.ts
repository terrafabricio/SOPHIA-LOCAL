import type { Migration } from "../migrate";

/**
 * Schema inicial. Migrações publicadas são imutáveis: qualquer mudança futura
 * entra numa nova migração, nunca editando esta.
 */
export const migration001: Migration = {
  version: 1,
  name: "initial",
  statements: [
    `CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    )`,
    `INSERT INTO categories (id, name, position) VALUES
      ('livro-tawa', 'Livro de Tawa', 1),
      ('sophia-apps', 'SOPHIA, Edith e aplicativos', 2),
      ('asymmetrika-negocios', 'Asymmetrika e negócios', 3),
      ('carreira-trabalho', 'Carreira e trabalho', 4),
      ('conteudo', 'Conteúdo, YouTube e newsletter', 5),
      ('estudos-ingles', 'Estudos e inglês', 6),
      ('vida-pessoal', 'Vida pessoal e rotina', 7),
      ('ideias-avulsas', 'Ideias avulsas', 8)`,

    `CREATE TABLE inbox_items (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL CHECK (length(trim(text)) > 0),
      source TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'converted', 'archived')),
      suggested_kind TEXT CHECK (suggested_kind IN
        ('note', 'idea', 'opportunity', 'task', 'project', 'decision', 'reference', 'appointment', 'reminder')),
      suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      converted_to_type TEXT CHECK (converted_to_type IN ('task', 'project', 'note')),
      converted_to_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_inbox_status ON inbox_items (status, created_at)`,

    `CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      objective TEXT,
      expected_outcome TEXT,
      scope TEXT,
      status TEXT NOT NULL CHECK (status IN
        ('idea', 'evaluating', 'approved', 'planned', 'active', 'paused', 'blocked', 'done', 'archived')),
      phase TEXT,
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
      due_date TEXT,
      next_step TEXT,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_projects_status ON projects (status)`,

    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN
        ('inbox', 'clarify', 'next', 'scheduled', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled')),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
      due_date TEXT,
      start_date TEXT,
      estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
      completed_at TEXT,
      inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_tasks_status ON tasks (status)`,
    `CREATE INDEX idx_tasks_project ON tasks (project_id)`,
    `CREATE INDEX idx_tasks_due ON tasks (due_date)`,

    `CREATE TABLE decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      context TEXT,
      rationale TEXT,
      proposed_by TEXT NOT NULL CHECK (proposed_by IN ('user', 'sophia')),
      status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
      superseded_by TEXT REFERENCES decisions(id) ON DELETE SET NULL,
      decided_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_decisions_project ON decisions (project_id, decided_at)`,

    `CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT,
      body TEXT NOT NULL CHECK (length(trim(body)) > 0),
      kind TEXT NOT NULL CHECK (kind IN ('note', 'idea', 'reference')),
      status TEXT NOT NULL CHECK (status IN ('current', 'outdated')),
      inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_notes_project ON notes (project_id)`,

    `CREATE TABLE reminders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'scheduled', 'fired', 'seen', 'cancelled', 'failed')),
      fired_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_reminders_due ON reminders (status, due_at)`,

    `CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      data TEXT,
      redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0, 1))
    )`,
    `CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id, id)`,

    `CREATE TABLE operations (
      idempotency_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ],
};
