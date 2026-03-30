import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDefaultDbPath(): string {
  const homeDir = path.join(os.homedir(), ".brainmcp");
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true });
  }
  return path.join(homeDir, "brain.db");
}

const DEFAULT_DB_PATH = getDefaultDbPath();

export function createDatabase(dbPath?: string): Database.Database {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('person','place','thing','event','idea','memory','feeling')),
      content TEXT,
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_name_type ON nodes(name, type);

    CREATE TABLE IF NOT EXISTS associations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'related_to',
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_id, target_id, label)
    );

    CREATE INDEX IF NOT EXISTS idx_assoc_source ON associations(source_id);
    CREATE INDEX IF NOT EXISTS idx_assoc_target ON associations(target_id);
  `);

  return db;
}
