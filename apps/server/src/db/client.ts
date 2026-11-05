import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.resolve(__dirname, "../../../../data/manyqueue.db");
const dbPath =
  process.env.DB_PATH && path.isAbsolute(process.env.DB_PATH)
    ? process.env.DB_PATH
    : defaultDbPath;

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
/** Either the top-level db or a handle inside an open transaction — for
 * functions that need to compose with an outer transaction's writes. */
export type DBOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
