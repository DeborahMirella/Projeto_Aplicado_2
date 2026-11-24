const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createClient } = require("@libsql/client");

function asNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("O banco retornou uma contagem fora do intervalo inteiro seguro.");
  }
  return number;
}

function createConfiguredClient(env = process.env) {
  const backend = String(env.DB_BACKEND || (env.TURSO_DATABASE_URL ? "turso" : "sqlite"))
    .trim().toLowerCase();

  if (backend === "turso") {
    const url = String(env.TURSO_DATABASE_URL || "").trim();
    const authToken = String(env.TURSO_AUTH_TOKEN || "").trim();
    if (!url || !authToken) {
      throw new Error("DB_BACKEND=turso exige TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.");
    }
    return { client: createClient({ url, authToken, intMode: "number" }), backend };
  }

  if (backend !== "sqlite") {
    throw new Error(`DB_BACKEND inválido (${backend}); use "sqlite" ou "turso".`);
  }

  const databasePath = path.resolve(env.SUSMAIS_DB_PATH || path.join(__dirname, "susmais.sqlite"));
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Banco SQLite não encontrado em ${databasePath}. Configure SUSMAIS_DB_PATH para um banco existente; nenhum banco vazio será criado.`);
  }
  if (!fs.statSync(databasePath).isFile()) {
    throw new Error(`O caminho SQLite ${databasePath} não aponta para um arquivo.`);
  }
  return { client: createClient({ url: pathToFileURL(databasePath).href, intMode: "number" }), backend, databasePath };
}

async function validateDatabase(client) {
  const tableResult = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = new Set(tableResult.rows.map(row => String(row.name)));
  if (!tables.has("datasets") || !tables.has("records")) {
    throw new Error("O banco não contém as tabelas datasets e records esperadas.");
  }

  // Imported metadata is part of the current schema even though the app does not
  // currently display this legacy flag. Refuse an incompatible schema up front.
  await client.execute("SELECT imported_once FROM datasets LIMIT 0");

  const [datasetResult, recordResult] = await Promise.all([
    client.execute("SELECT COUNT(*) AS count FROM datasets"),
    client.execute("SELECT COUNT(*) AS count FROM records")
  ]);
  const datasetCount = asNumber(datasetResult.rows[0].count);
  const recordCount = asNumber(recordResult.rows[0].count);
  if (datasetCount === 0 || recordCount === 0) {
    throw new Error("O banco não contém conjuntos e registros. Inicialização interrompida para evitar servir um banco vazio.");
  }
  return { datasetCount, recordCount };
}

async function openConfiguredDatabase({ setupMode = false, env = process.env } = {}) {
  if (setupMode) return { client: null, backend: null, counts: null };
  const configured = createConfiguredClient(env);
  try {
    const counts = await validateDatabase(configured.client);
    return { ...configured, counts };
  } catch (error) {
    configured.client.close();
    throw error;
  }
}

module.exports = { asNumber, createConfiguredClient, openConfiguredDatabase, validateDatabase };
