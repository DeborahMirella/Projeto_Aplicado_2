const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { createClient } = require("@libsql/client");
const { migrateToClient } = require("../scripts/migrate-sqlite-to-turso");

test("migra uma cópia do SQLite sem dados pessoais nos logs e é idempotente", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "susmais-migration-copy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sourceCopy = path.join(dir, "source-copy.sqlite");
  const targetPath = path.join(dir, "target.sqlite");
  const originalPath = path.join(__dirname, "..", "susmais.sqlite");
  fs.copyFileSync(originalPath, sourceCopy);

  const target = createClient({ url: pathToFileURL(targetPath).href, intMode: "number" });
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => logs.push(values.map(String).join(" "));
  try {
    assert.equal(await migrateToClient(sourceCopy, target), "migrated");
    assert.equal(await migrateToClient(sourceCopy, target), "already");
  } finally {
    console.log = originalLog;
    target.close();
  }

  const verify = createClient({ url: pathToFileURL(targetPath).href, intMode: "number" });
  try {
    const datasets = await verify.execute("SELECT COUNT(*) AS count FROM datasets");
    const records = await verify.execute("SELECT COUNT(*) AS count FROM records");
    assert.equal(Number(datasets.rows[0].count), 9);
    assert.equal(Number(records.rows[0].count), 7759);
    assert.equal(logs.filter(line => line.includes("Migração verificada:")).length, 1);
    assert.equal(logs.filter(line => line.includes("cópia íntegra e idêntica")).length, 1);
    assert.ok(logs.every(line => !/\b\d{9,11}\b/.test(line)));
  } finally {
    verify.close();
  }
});
