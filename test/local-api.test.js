const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

test("SQLite local atende as quatro APIs sem expor campos sensíveis", async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "susmais-local-api-"));
  const databasePath = path.join(tempDir, "local.sqlite");
  const uploadPath = path.join(tempDir, "uploads");
  const fixture = new Database(databasePath);
  fixture.exec(`
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
    CREATE INDEX idx_records_dataset ON records(dataset_id);
    CREATE TRIGGER reject_test_row BEFORE INSERT ON records
    WHEN NEW.row_data LIKE '%"marker":"fail"%'
    BEGIN SELECT RAISE(ABORT, 'test rollback'); END;
  `);
  fixture.prepare("INSERT INTO datasets(id,category,source,filename,row_count) VALUES(1,?,?,?,1)").run("Estabelecimentos de saúde", "CNES", "estabelecimentos-310620.csv");
  fixture.prepare("INSERT INTO records(id,dataset_id,row_data) VALUES(1,1,?)").run(JSON.stringify({
    CNES: "12345", IBGE: "310620", BAIRRO: "Centro", "NOME FANTASIA": "UBS Exemplo",
    "RAZAO SOCIAL": "Unidade Exemplo", LATITUDE: "-19.9", LONGITUDE: "-43.9", CPF: "deve ser removido"
  }));
  fixture.close();

  process.env.DB_BACKEND = "sqlite";
  process.env.SUSMAIS_SETUP_MODE = "false";
  process.env.SUSMAIS_DB_PATH = databasePath;
  process.env.UPLOAD_DIR = uploadPath;
  process.env.IMPORT_BACKUP_DIR = path.join(tempDir, "backups");
  process.env.ADMIN_TOKEN = "test-admin-token";
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  const { startServer } = require("../server");
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const datasetsResponse = await fetch(`${base}/api/datasets`);
  assert.equal(datasetsResponse.status, 200);
  assert.equal((await datasetsResponse.json()).length, 1);

  const searchResponse = await fetch(`${base}/api/search?datasetId=1`);
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.equal(search.length, 1);
  assert.equal("CPF" in search[0], false);

  const dashboardResponse = await fetch(`${base}/api/dashboard`);
  assert.equal(dashboardResponse.status, 200);
  assert.equal((await dashboardResponse.json()).counts.establishments, 1);

  const citizenResponse = await fetch(`${base}/api/citizen/units`);
  assert.equal(citizenResponse.status, 200);
  assert.equal((await citizenResponse.json()).units.length, 1);

  const form = new FormData();
  form.append("file", new Blob(["CPF;Municipio\n12345678900;Belo Horizonte\n"], { type: "text/csv" }), "fixture-import.csv");
  form.append("category", "Conjunto de teste");
  form.append("source", "Fixture");
  const importResponse = await fetch(`${base}/api/import`, {
    method: "POST",
    headers: { "x-admin-token": "test-admin-token" },
    body: form
  });
  assert.equal(importResponse.status, 200);
  assert.equal((await importResponse.json()).rows, 1);
  const imported = await fetch(`${base}/api/search?datasetId=2`).then(response => response.json());
  assert.equal(imported.length, 1);
  assert.equal("CPF" in imported[0], false);

  const failingForm = new FormData();
  failingForm.append("file", new Blob(["marker\nfail\n"], { type: "text/csv" }), "rollback.csv");
  failingForm.append("category", "Importação que deve reverter");
  const failedImport = await fetch(`${base}/api/import`, {
    method: "POST",
    headers: { "x-admin-token": "test-admin-token" },
    body: failingForm
  });
  assert.equal(failedImport.status, 400);
  assert.equal((await fetch(`${base}/api/datasets`).then(response => response.json())).length, 2);
  assert.equal((await fetch(`${base}/api/search?datasetId=2`).then(response => response.json())).length, 1);
  const backups = fs.readdirSync(process.env.IMPORT_BACKUP_DIR);
  assert.equal(backups.length, 2);
  for (const name of backups) assert.equal(fs.statSync(path.join(process.env.IMPORT_BACKUP_DIR, name)).mode & 0o777, 0o600);
});
