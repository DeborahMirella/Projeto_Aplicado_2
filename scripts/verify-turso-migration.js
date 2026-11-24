#!/usr/bin/env node
const path = require("path");
const crypto = require("crypto");
const { createConfiguredClient, asNumber } = require("../database-client");
const { readSource, verifyHashes } = require("./migrate-sqlite-to-turso");

const API_ENDPOINTS = [
  "/api/datasets",
  "/api/search?mode=all",
  "/api/dashboard",
  "/api/citizen/units"
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

async function compareApis(localUrl, remoteUrl, fetchImpl = fetch) {
  for (const endpoint of API_ENDPOINTS) {
    const [localResponse, remoteResponse] = await Promise.all([
      fetchImpl(new URL(endpoint, localUrl)),
      fetchImpl(new URL(endpoint, remoteUrl))
    ]);
    if (!localResponse.ok || !remoteResponse.ok) {
      throw new Error(`API ${endpoint} retornou HTTP ${localResponse.status} local / ${remoteResponse.status} remoto.`);
    }
    const [localJson, remoteJson] = await Promise.all([localResponse.json(), remoteResponse.json()]);
    if (digest(localJson) !== digest(remoteJson)) {
      throw new Error(`As respostas de ${endpoint} diferem entre SQLite e Turso.`);
    }
    console.log(`API ${endpoint}: respostas equivalentes.`);
  }
}

async function executeRemote(client, sql, description) {
  try {
    return await client.execute(sql);
  } catch (error) {
    if (error && error.code === "SERVER_ERROR" && /HTTP status 401\b/.test(String(error.message))) {
      const authError = new Error(`Turso retornou HTTP 401 na consulta ${description}. A comparação das APIs HTTP ainda não começou; confira TURSO_DATABASE_URL e TURSO_AUTH_TOKEN usados por este processo.`);
      authError.code = "TURSO_AUTH";
      throw authError;
    }
    throw error;
  }
}

async function verify(sourcePath) {
  const sourceData = readSource(sourcePath);
  let remote;
  try {
    remote = createConfiguredClient({ ...process.env, DB_BACKEND: "turso" });
    const datasetResult = await executeRemote(remote.client, "SELECT COUNT(*) AS count FROM datasets", "contagem de conjuntos");
    const recordResult = await executeRemote(remote.client, "SELECT COUNT(*) AS count FROM records", "contagem de registros");
    const counts = {
      datasets: asNumber(datasetResult.rows[0].count),
      records: asNumber(recordResult.rows[0].count)
    };
    if (counts.datasets !== 9 || counts.records !== 7759) {
      throw new Error(`Contagem remota divergente: ${counts.datasets} conjuntos e ${counts.records} registros.`);
    }

    const [remoteData, orphanResult, integrityResult, foreignKeyResult] = await Promise.all([
      Promise.all([
        executeRemote(remote.client, "SELECT id,category,source,filename,sheet_name,reference_period,extracted_at,row_count,imported_once FROM datasets ORDER BY id", "leitura de metadados dos conjuntos"),
        executeRemote(remote.client, "SELECT id,dataset_id,row_data FROM records ORDER BY id", "leitura de registros para comparação de hash")
      ]).then(([datasets, records]) => ({ datasets: datasets.rows, records: records.rows })),
      executeRemote(remote.client, "SELECT COUNT(*) AS count FROM records r LEFT JOIN datasets d ON d.id=r.dataset_id WHERE d.id IS NULL", "verificação de vínculos"),
      executeRemote(remote.client, "PRAGMA integrity_check", "integrity_check"),
      executeRemote(remote.client, "PRAGMA foreign_key_check", "foreign_key_check")
    ]);
    if (asNumber(orphanResult.rows[0].count) !== 0 || foreignKeyResult.rows.length !== 0) {
      throw new Error("O destino tem vínculos inválidos.");
    }
    const integrity = integrityResult.rows.map(row => String(row.integrity_check || Object.values(row)[0])).join(";");
    if (integrity !== "ok") throw new Error("PRAGMA integrity_check não retornou ok no destino.");

    const hashes = verifyHashes(sourceData, remoteData);
    if (!hashes.equal) throw new Error("IDs, metadados, row_data ou relacionamentos diferem da origem.");
    console.log(`Banco: ${counts.datasets} conjuntos, ${counts.records} registros; integridade e relacionamentos válidos.`);
    console.log(`SHA-256 conjuntos: ${hashes.sourceDatasetHash}`);
    console.log(`SHA-256 registros: ${hashes.sourceRecordHash}`);

    const localApi = process.env.LOCAL_API_URL;
    const remoteApi = process.env.REMOTE_API_URL;
    if (localApi && remoteApi) {
      await compareApis(localApi, remoteApi);
    } else {
      console.log("APIs não comparadas: defina LOCAL_API_URL e REMOTE_API_URL para testar os quatro endpoints.");
    }
  } finally {
    sourceData.source.close();
    if (remote) remote.client.close();
  }
}

if (require.main === module) {
  const sourcePath = path.resolve(process.argv[2] || process.env.SUSMAIS_DB_PATH || path.join(__dirname, "..", "susmais.sqlite"));
  verify(sourcePath).catch(error => {
    const code = error && error.code ? ` (${String(error.code)})` : "";
    console.error(`Verificação falhou${code}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { API_ENDPOINTS, compareApis, executeRemote, verify };
