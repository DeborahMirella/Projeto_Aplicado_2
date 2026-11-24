const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { openConfiguredDatabase } = require("../database-client");

function makeDatabase(databasePath, withRows = true) {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL, source TEXT NOT NULL, filename TEXT NOT NULL,
      sheet_name TEXT, reference_period TEXT, extracted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      row_count INTEGER DEFAULT 0, imported_once INTEGER DEFAULT 0
    );
    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      row_data TEXT NOT NULL
    );
  `);
  if (withRows) {
    db.prepare("INSERT INTO datasets(category,source,filename,row_count) VALUES(?,?,?,?)").run("Test", "Fonte", "fixture.csv", 1);
    db.prepare("INSERT INTO records(dataset_id,row_data) VALUES(?,?)").run(1, JSON.stringify({ indicador: "teste" }));
  }
  db.close();
}

test("abre SQLite local existente sem alterar o modo de desenvolvimento", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "susmais-libsql-local-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "local.sqlite");
  makeDatabase(databasePath);

  const opened = await openConfiguredDatabase({ env: { DB_BACKEND: "sqlite", SUSMAIS_DB_PATH: databasePath } });
  assert.equal(opened.backend, "sqlite");
  assert.deepEqual(opened.counts, { datasetCount: 1, recordCount: 1 });
  opened.client.close();
});

test("recusa SQLite ausente sem criar um banco vazio", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "susmais-libsql-missing-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "missing.sqlite");
  await assert.rejects(openConfiguredDatabase({ env: { DB_BACKEND: "sqlite", SUSMAIS_DB_PATH: databasePath } }), /não encontrado/);
  assert.equal(fs.existsSync(databasePath), false);
});

test("recusa banco local vazio", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "susmais-libsql-empty-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, "empty.sqlite");
  makeDatabase(databasePath, false);
  await assert.rejects(openConfiguredDatabase({ env: { DB_BACKEND: "sqlite", SUSMAIS_DB_PATH: databasePath } }), /banco vazio/);
});

test("modo de preparação não exige nem tenta abrir banco ou credenciais Turso", async () => {
  const opened = await openConfiguredDatabase({ setupMode: true, env: { DB_BACKEND: "turso" } });
  assert.equal(opened.client, null);
  assert.equal(opened.counts, null);
});

test("modo Turso interrompe a inicialização sem URL e token", async () => {
  await assert.rejects(openConfiguredDatabase({ env: { DB_BACKEND: "turso" } }), /TURSO_DATABASE_URL e TURSO_AUTH_TOKEN/);
});
