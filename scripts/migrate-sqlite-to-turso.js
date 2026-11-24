#!/usr/bin/env node
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { createConfiguredClient, asNumber } = require("../database-client");

const DATASET_COLUMNS = "id,category,source,filename,sheet_name,reference_period,extracted_at,row_count,imported_once";
const RECORD_COLUMNS = "id,dataset_id,row_data";

function scalar(value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function hashRows(rows, columns) {
  const hash = crypto.createHash("sha256");
  for (const row of rows) {
    hash.update(JSON.stringify(columns.map(column => scalar(row[column]))));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function readSource(sourcePath) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = source.pragma("integrity_check", { simple: true });
    const fkViolations = source.pragma("foreign_key_check");
    if (integrity !== "ok") throw new Error("O SQLite de origem falhou em integrity_check.");
    if (fkViolations.length) throw new Error("O SQLite de origem contém violações de chave estrangeira.");

    const datasets = source.prepare(`SELECT ${DATASET_COLUMNS} FROM datasets ORDER BY id`).all();
    const records = source.prepare(`SELECT ${RECORD_COLUMNS} FROM records ORDER BY id`).all();
    const sequences = Object.fromEntries(source.prepare("SELECT name,seq FROM sqlite_sequence").all().map(row => [row.name, Number(row.seq)]));
    if (datasets.length !== 9 || records.length !== 7759) {
      throw new Error(`A origem esperada deve conter 9 conjuntos e 7759 registros; encontrados ${datasets.length} e ${records.length}.`);
    }
    if (sequences.datasets !== Math.max(...datasets.map(row => row.id)) || sequences.records !== Math.max(...records.map(row => row.id))) {
      throw new Error("As sequências SQLite divergem dos IDs máximos; a migração foi interrompida para preservar os próximos IDs.");
    }
    const orphanCount = source.prepare("SELECT COUNT(*) AS count FROM records r LEFT JOIN datasets d ON d.id=r.dataset_id WHERE d.id IS NULL").get().count;
    if (orphanCount) throw new Error("A origem contém registros sem conjunto associado.");
    return { source, datasets, records, sequences };
  } catch (error) {
    source.close();
    throw error;
  }
}

async function readRemoteRows(client) {
  const datasetsResult = await client.execute(`SELECT ${DATASET_COLUMNS} FROM datasets ORDER BY id`);
  const recordsResult = await client.execute(`SELECT ${RECORD_COLUMNS} FROM records ORDER BY id`);
  return { datasets: datasetsResult.rows, records: recordsResult.rows };
}

function verifyHashes(sourceData, remoteData) {
  const sourceDatasetHash = hashRows(sourceData.datasets, DATASET_COLUMNS.split(","));
  const remoteDatasetHash = hashRows(remoteData.datasets, DATASET_COLUMNS.split(","));
  const sourceRecordHash = hashRows(sourceData.records, RECORD_COLUMNS.split(","));
  const remoteRecordHash = hashRows(remoteData.records, RECORD_COLUMNS.split(","));
  return {
    equal: sourceDatasetHash === remoteDatasetHash && sourceRecordHash === remoteRecordHash,
    sourceDatasetHash,
    remoteDatasetHash,
    sourceRecordHash,
    remoteRecordHash
  };
}

async function checkRemoteIntegrity(client) {
  const integrityResult = await client.execute("PRAGMA integrity_check");
  const integrity = integrityResult.rows.map(row => String(row.integrity_check || Object.values(row)[0])).join(";");
  if (integrity !== "ok") throw new Error("O banco remoto falhou em integrity_check.");
  const fkResult = await client.execute("PRAGMA foreign_key_check");
  if (fkResult.rows.length) throw new Error("O banco remoto contém violações de chave estrangeira.");
  const orphanResult = await client.execute("SELECT COUNT(*) AS count FROM records r LEFT JOIN datasets d ON d.id=r.dataset_id WHERE d.id IS NULL");
  if (asNumber(orphanResult.rows[0].count)) throw new Error("O banco remoto contém registros sem conjunto associado.");
}

async function ensureTargetSchema(client) {
  const tableResult = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = new Set(tableResult.rows.map(row => String(row.name)));
  const hasDatasets = tables.has("datasets");
  const hasRecords = tables.has("records");
  if (hasDatasets !== hasRecords) throw new Error("O destino tem um esquema parcial; nenhum dado foi alterado.");
  if (!hasDatasets && tables.size) throw new Error("O destino não está vazio; nenhum dado foi alterado.");
  if (!hasDatasets) {
    await client.execute(`CREATE TABLE datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      filename TEXT NOT NULL,
      sheet_name TEXT,
      reference_period TEXT,
      extracted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      row_count INTEGER DEFAULT 0,
      imported_once INTEGER DEFAULT 0
    )`);
    await client.execute(`CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      row_data TEXT NOT NULL
    )`);
  } else {
    await client.execute("SELECT imported_once FROM datasets LIMIT 0");
  }
  await client.execute("CREATE INDEX IF NOT EXISTS idx_records_dataset ON records(dataset_id)");
}

async function counts(client) {
  const [datasetResult, recordResult] = await Promise.all([
    client.execute("SELECT COUNT(*) AS count FROM datasets"),
    client.execute("SELECT COUNT(*) AS count FROM records")
  ]);
  return { datasets: asNumber(datasetResult.rows[0].count), records: asNumber(recordResult.rows[0].count) };
}

async function migrateToClient(sourcePath, client) {
  const sourceData = readSource(sourcePath);
  try {
    await ensureTargetSchema(client);
    const existingCounts = await counts(client);

    if (existingCounts.datasets || existingCounts.records) {
      const alreadyThere = existingCounts.datasets === sourceData.datasets.length && existingCounts.records === sourceData.records.length;
      if (alreadyThere) {
        const remoteData = await readRemoteRows(client);
        const hashes = verifyHashes(sourceData, remoteData);
        if (hashes.equal) {
          await checkRemoteIntegrity(client);
          console.log("Destino já contém cópia íntegra e idêntica; nenhuma linha foi inserida.");
          console.log(`Conjuntos: ${existingCounts.datasets}; registros: ${existingCounts.records}.`);
          console.log(`SHA-256 conjuntos: ${hashes.sourceDatasetHash}`);
          console.log(`SHA-256 registros: ${hashes.sourceRecordHash}`);
          return "already";
        }
      }
      throw new Error("O destino contém dados diferentes ou parciais. A rotina não adiciona nem substitui linhas.");
    }

    const tx = await client.transaction("write");
    try {
      const statements = [];
      for (const row of sourceData.datasets) {
        statements.push({
          sql: `INSERT INTO datasets(${DATASET_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?)`,
          args: DATASET_COLUMNS.split(",").map(column => scalar(row[column]))
        });
      }
      for (const row of sourceData.records) {
        statements.push({
          sql: `INSERT INTO records(${RECORD_COLUMNS}) VALUES(?,?,?)`,
          args: RECORD_COLUMNS.split(",").map(column => scalar(row[column]))
        });
      }
      for (let offset = 0; offset < statements.length; offset += 250) {
        await tx.batch(statements.slice(offset, offset + 250));
      }
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch (_) {}
      throw error;
    }

    const finalCounts = await counts(client);
    const remoteData = await readRemoteRows(client);
    const hashes = verifyHashes(sourceData, remoteData);
    await checkRemoteIntegrity(client);
    if (finalCounts.datasets !== sourceData.datasets.length || finalCounts.records !== sourceData.records.length || !hashes.equal) {
      throw new Error("A verificação posterior à migração encontrou diferenças.");
    }
    console.log(`Migração verificada: ${finalCounts.datasets} conjuntos e ${finalCounts.records} registros.`);
    console.log(`SHA-256 conjuntos: ${hashes.sourceDatasetHash}`);
    console.log(`SHA-256 registros: ${hashes.sourceRecordHash}`);
    return "migrated";
  } finally {
    sourceData.source.close();
  }
}

async function migrate(sourcePath) {
  const target = createConfiguredClient({ ...process.env, DB_BACKEND: "turso" });
  try {
    return await migrateToClient(sourcePath, target.client);
  } finally {
    target.client.close();
  }
}

if (require.main === module) {
  const sourcePath = path.resolve(process.argv[2] || process.env.SUSMAIS_DB_PATH || path.join(__dirname, "..", "susmais.sqlite"));
  migrate(sourcePath).catch(error => {
    const code = error && error.code ? ` (${String(error.code)})` : "";
    console.error(`Migração interrompida${code}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { hashRows, migrate, migrateToClient, readSource, verifyHashes };
