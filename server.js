const express = require("express");
const multer = require("multer");
const Database = require("better-sqlite3");
const { openConfiguredDatabase } = require("./database-client");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const app = express();
const databasePath = path.resolve(process.env.SUSMAIS_DB_PATH || path.join(__dirname, "susmais.sqlite"));
const setupMode = String(process.env.SUSMAIS_SETUP_MODE || "").trim().toLowerCase() === "true";
const setupMessage = "Sistema em preparação: configure o banco de dados e reinicie o serviço com SUSMAIS_SETUP_MODE=false.";
let db = null;
let databaseBackend = null;
const adminToken = String(process.env.ADMIN_TOKEN || "").trim();
if (!adminToken) {
  console.error("ADMIN_TOKEN não configurado; importações administrativas estão desativadas, inclusive em produção.");
}
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"));
function assertWritableDirectory(directory) {
  fs.accessSync(directory, fs.constants.W_OK | fs.constants.X_OK);
  const probePath = path.join(directory, `.susmais-write-check-${process.pid}-${Date.now()}`);
  let descriptor;
  try {
    descriptor = fs.openSync(probePath, "wx", 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.unlinkSync(probePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
    try { fs.unlinkSync(probePath); } catch (_) {}
    throw error;
  }
}

function prepareUploadDirectory(directory) {
  const renderDiskPath = path.resolve("/var/data");
  const relativeToRenderDisk = path.relative(renderDiskPath, directory);
  const usesRenderDisk = relativeToRenderDisk === "" ||
    (!relativeToRenderDisk.startsWith(`..${path.sep}`) && relativeToRenderDisk !== ".." && !path.isAbsolute(relativeToRenderDisk));

  let directoryStats;
  try {
    directoryStats = fs.statSync(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (directoryStats) {
    if (!directoryStats.isDirectory()) {
      throw new Error(`${directory} existe, mas não é um diretório`);
    }
    try {
      assertWritableDirectory(directory);
    } catch (error) {
      throw new Error(`${directory} não está disponível para gravação: ${error.message}`);
    }
    return;
  }

  if (usesRenderDisk) {
    let renderDiskStats;
    try {
      renderDiskStats = fs.statSync(renderDiskPath);
    } catch (_) {
      throw new Error(`o disco persistente do Render não está montado em ${renderDiskPath}; ele não será criado automaticamente`);
    }
    if (!renderDiskStats.isDirectory()) {
      throw new Error(`${renderDiskPath} existe, mas não é um diretório de montagem`);
    }
  }

  const parentDirectory = path.dirname(directory);
  let parentStats;
  try {
    parentStats = fs.statSync(parentDirectory);
  } catch (_) {
    throw new Error(`o diretório pai ${parentDirectory} não está disponível; nenhum diretório pai será criado automaticamente`);
  }
  if (!parentStats.isDirectory()) {
    throw new Error(`o diretório pai ${parentDirectory} não é um diretório`);
  }
  try { assertWritableDirectory(parentDirectory); }
  catch (_) { throw new Error(`o diretório pai ${parentDirectory} não permite criar ${directory}`); }

  try {
    fs.mkdirSync(directory);
  } catch (mkdirError) {
    throw new Error(`não foi possível criar ${directory}: ${mkdirError.message}`);
  }

  try {
    assertWritableDirectory(directory);
  } catch (error) {
    throw new Error(`${directory} não está disponível para gravação: ${error.message}`);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      // This callback runs only after the import route's setup and token guards.
      // Keep the setup check here too so this path is never inspected in setup mode.
      if (setupMode || !db) {
        return callback(new Error(setupMessage));
      }
      try {
        prepareUploadDirectory(uploadDirectory);
        callback(null, uploadDirectory);
      } catch (error) {
        callback(new Error(`UPLOAD_DIR inválido (${uploadDirectory}): ${error.message}`));
      }
    },
    filename: (_req, _file, callback) => {
      callback(null, crypto.randomBytes(16).toString("hex"));
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024 }
});

function requireDatabase(_req, res, next) {
  if (setupMode || !db) {
    return res.status(503).json({ error: setupMessage, setup: true });
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function jsonSafe(value) {
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

function norm(v) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}
function forbiddenKey(k) {
  const n = norm(k).replace(/[^a-z0-9]/g, "");
  return /^(cns|cartaosus|cpf|matricula|matriculafuncional|nome|nomecompleto|nomedoprofissional|telefone|celular|email|datanascimento|nascimento)$/.test(n);
}
function safeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) if (!forbiddenKey(key)) out[String(key).trim()] = value;
  return out;
}
function decodeCsv(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le").replace(/^\ufeff/, "");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8").replace(/^\ufeff/, "");
  const utf8 = buf.toString("utf8");
  const replacementCount = (utf8.match(/\ufffd/g) || []).length;
  if (replacementCount === 0) return utf8;
  return new TextDecoder("windows-1252").decode(buf);
}
function delimiterFor(text) {
  const sample = text.split(/\r?\n/).slice(0, 30).join("\n");
  const semi = (sample.match(/;/g) || []).length;
  const comma = (sample.match(/,/g) || []).length;
  return semi >= comma ? ";" : ",";
}
function parseDelimited(text, headerIndex) {
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
  const delimiter = delimiterFor(lines.slice(headerIndex).join("\n"));
  const usable = lines.slice(headerIndex).join("\n");
  return parse(usable, { columns: true, skip_empty_lines: true, delimiter, bom: true, relax_column_count: true, relax_quotes: true });
}
function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const signature = JSON.stringify(row);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function parseFile(file, originalName, requestedCategory, requestedPeriod) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.readFile(file, { cellDates: false });
    const out = [];
    const professionalImport = /Profissionais/i.test(requestedCategory);
    for (const sheet of wb.SheetNames) {
      if (professionalImport && !/ACS/i.test(sheet)) continue;
      let rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: "", raw: false }).map(safeRow);
      if (/cobertura/i.test(originalName)) rows = rows.filter(r => r[Object.keys(r)[0]] || r["Comp. CNES"]);
      if (/equipes-servicos/i.test(originalName) || professionalImport) {
        rows = rows.filter(r => String(r.IBGE || r["Código IBGE"] || "").trim() === "310620");
      }
      if (professionalImport) {
        rows = rows.map(r => ({
          "Comp. CNES": r["Comp. CNES"] || "",
          UF: r.UF || "",
          Municipio: r.Municipio || r["Município"] || "",
          IBGE: r.IBGE || "",
          CBO: r.CBO || "",
          "Status do envio de produção": r["Status do envio de produção"] || "",
          "Qtde. de competências consecutivas sem envio": r["Qtde. de competências consecutivas sem envio"] || ""
        })).filter(r => r.CBO || r["Status do envio de produção"]);
      }
      if (sheet !== "ACS" || professionalImport) rows = professionalImport ? rows : uniqueRows(rows);
      out.push({ sheet: professionalImport ? "Profissionais ACS" : sheet, rows });
    }
    return out;
  }
  if (ext === ".csv" || ext === ".txt") {
    const text = decodeCsv(fs.readFileSync(file));
    const lines = text.split(/\r?\n/);
    let rows;
    if (/estabelecimentos-310620/i.test(originalName)) {
      const header = lines.findIndex(l => /^IBGE;UF;MUNICIPIO;CNES;/i.test(l));
      if (header < 0) throw new Error("Não foi encontrado o cabeçalho CNES esperado.");
      rows = parseDelimited(text, header).map(safeRow);
    } else if (/sia_cnv/i.test(originalName)) {
      const header = lines.findIndex(l => l.includes(";") && norm(l).includes("municipio") && norm(l).includes("qtd.aprovada"));
      if (header < 0) throw new Error("Não foi encontrado o cabeçalho do SIA/SUS.");
      rows = lines.slice(header + 1).map(line => {
        const cols = line.split(";").map(v => v.replace(/^"|"$/g, "").trim());
        return cols.length >= 2 ? { "Município": cols[0], "Qtd.aprovada": cols[1] } : null;
      }).filter(r => r && /^310620/i.test(r["Município"]));
    } else if (/RelatorioSaudeProducao/i.test(originalName)) {
      const header = lines.findIndex(l => /^Uf;Ibge;Municipio;/i.test(l));
      if (header < 0) throw new Error("Não foi encontrado o cabeçalho real do SISAB.");
      rows = parseDelimited(text, header).map(safeRow).filter(r => String(r.Ibge || r.IBGE || "") === "310620");
    } else {
      const semicolonHeader = lines.findIndex(l => /CNES|MUNICIPIO|MUNICÍPIO|IBGE|UF/i.test(l) && (l.match(/;/g)||[]).length >= 2);
      const commaHeader = lines.findIndex(l => /CNES|MUNICIPIO|MUNICÍPIO|IBGE|UF/i.test(l) && (l.match(/,/g)||[]).length >= 2);
      const header = semicolonHeader >= 0 ? semicolonHeader : Math.max(commaHeader, 0);
      rows = parseDelimited(text, header).map(safeRow);
    }
    return [{ sheet: null, rows: uniqueRows(rows) }];
  }
  throw new Error("Formato não suportado. Envie CSV, XLS ou XLSX.");
}

function inferPeriod(category, source, filename, sheets) {
  if (/SIA\/SUS/i.test(source)) return "Ago/2026";
  if (/SISAB/i.test(source)) return "JAN/2026 a SET/2026";
  if (/cobertura-acs/i.test(filename)) return "JAN/2026 a AGO/2026";
  if (/cobertura-aps/i.test(filename)) return "JAN/2026 a AGO/2026";
  if (/equipes-servicos/i.test(filename)) return "AGO/2026";
  if (/profissionais-acs/i.test(filename)) return "AGO/2026";
  return "Período não informado no arquivo";
}

async function importDataset(file, originalName, category, source, period) {
  const sheets = parseFile(file, originalName, category, period);
  const resolvedPeriod = period || inferPeriod(category, source, originalName, sheets);
  const tx = await db.transaction("write");
  try {
    for (const s of sheets) {
      const info = await tx.execute({
        sql: "INSERT INTO datasets(category,source,filename,sheet_name,reference_period,row_count) VALUES(?,?,?,?,?,?)",
        args: [category, source, originalName, s.sheet, resolvedPeriod, s.rows.length]
      });
      if (info.lastInsertRowid === undefined) throw new Error("O banco não retornou o ID do conjunto importado.");
      const statements = s.rows.map(row => ({
        sql: "INSERT INTO records(dataset_id,row_data) VALUES(?,?)",
        args: [info.lastInsertRowid, JSON.stringify(row)]
      }));
      for (let offset = 0; offset < statements.length; offset += 250) {
        await tx.batch(statements.slice(offset, offset + 250));
      }
    }
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch (_) {}
    throw error;
  }
  return { sheets: sheets.length, rows: sheets.reduce((n, s) => n + s.rows.length, 0) };
}

app.get("/api/datasets", requireDatabase, asyncRoute(async (_req, res) => {
  const result = await db.execute("SELECT id,category,source,filename,sheet_name,reference_period,extracted_at,row_count FROM datasets ORDER BY id DESC");
  res.json(jsonSafe(result.rows));
}));

app.get("/api/search", requireDatabase, asyncRoute(async (req, res) => {
  const datasetId = Number(req.query.datasetId || 0);
  const q = norm(req.query.q || "");
  const mode = req.query.mode === "any" ? "any" : "all";
  const filters = [];
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("f_") && String(value).trim()) filters.push([key.slice(2), norm(value)]);
  }
  let sql = `SELECT r.id,r.row_data,d.category,d.source,d.filename,d.sheet_name,d.reference_period FROM records r JOIN datasets d ON d.id=r.dataset_id WHERE 1=1`;
  const params = [];
  if (datasetId) { sql += " AND d.id=?"; params.push(datasetId); }
  const result = await db.execute({ sql: sql + " ORDER BY r.id LIMIT 5000", args: params });
  const rows = result.rows;
  const matched = rows.filter(rec => {
    const data = safeRow(JSON.parse(rec.row_data));
    const entries = Object.entries(data).filter(([k]) => !forbiddenKey(k));
    const textOk = !q || entries.some(([k, v]) => norm(k).includes(q) || norm(v).includes(q));
    const checks = filters.map(([field, value]) => entries.some(([k, v]) => norm(k) === norm(field) && norm(v).includes(value)));
    const filterOk = !checks.length || (mode === "any" ? checks.some(Boolean) : checks.every(Boolean));
    return textOk && filterOk;
  });
  res.json(jsonSafe(matched.slice(0, 200).map(rec => ({ id: rec.id, ...safeRow(JSON.parse(rec.row_data)), _categoria: rec.category, _fonte: rec.source, _arquivo: rec.filename, _aba: rec.sheet_name, _periodo: rec.reference_period }))));
}));

app.get("/api/dashboard", requireDatabase, asyncRoute(async (_req, res) => {
  const result = await db.execute("SELECT d.category,d.source,d.filename,d.sheet_name,d.reference_period,r.row_data FROM records r JOIN datasets d ON d.id=r.dataset_id ORDER BY r.id");
  const rows = result.rows.map(x => ({ ...x, data: safeRow(JSON.parse(x.row_data)) }));
  const findCategory = prefix => rows.filter(r => r.category.includes(prefix));
  const cnes = findCategory("Estabelecimentos");
  const sisab = findCategory("Produção da Atenção Primária");
  const sia = findCategory("Produção ambulatorial");
  const aps = findCategory("cobertura da APS");
  const acs = findCategory("cobertura de ACS");
  const monitor = findCategory("Monitoramento");
  const latest = (list, field) => list.map(r => r.data[field]).filter(Boolean).slice(-8);
  const professionals = findCategory("Profissionais");
  const professionalRows = professionals.map(r => r.data);
  const professionalCount = professionalRows.length;
  const cboCounts = [...new Map(professionalRows.filter(r => r.CBO).map(r => [r.CBO, professionalRows.filter(x => x.CBO === r.CBO).length])).values()].length
    ? [...professionalRows.reduce((m,r)=>{if(r.CBO)m.set(r.CBO,(m.get(r.CBO)||0)+1);return m},new Map())].map(([cbo,count])=>({cbo,count}))
    : [];
  const statusCounts = [...professionalRows.reduce((m,r)=>{const status=String(r["Status do envio de produção"]||"").trim();if(status)m.set(status,(m.get(status)||0)+1);return m},new Map())].map(([status,count])=>({status,count}));
  res.json(jsonSafe({
    counts: { establishments: cnes.length, sisab: sisab.length, sia: sia.length, aps: aps.length, acs: acs.length, monitor: monitor.length, professionals: professionalCount },
    acsSeries: acs.map(r => ({ competence: r.data["Comp. CNES"] || "", coverage: r.data["Cobertura ACS"] || "" })).filter(x => x.competence),
    apsSeries: aps.map(r => ({ competence: r.data["Comp. CNES"] || "", capacity: r.data["Qt. capacidade da equipe"] || "" })).filter(x => x.competence),
    sisab: sisab.map(r => r.data),
    sia: sia.map(r => r.data),
    monitor: monitor.map(r => ({ sheet: r.sheet_name, municipality: r.data.Município || r.data.Municipio || "", status: r.data["Situação do envio de produção"] || r.data["Status do envio de produção"] || "", count: r.data["Qtde. de competências consecutivas sem envio"] || "", cnes: r.data.CNES || "" })),
    professionals: professionalRows,
    cboCounts,
    statusCounts
  }));
}));

function createImportBackupPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(process.env.IMPORT_BACKUP_DIR || path.join(os.tmpdir(), "susmais-backups"));
  return path.join(directory, `susmais.before-import-${timestamp}.sqlite`);
}

async function exportRemoteBackup(backupPath) {
  const readTransaction = await db.transaction("read");
  let datasets;
  let records;
  let sequences;
  try {
    datasets = (await readTransaction.execute("SELECT id,category,source,filename,sheet_name,reference_period,extracted_at,row_count,imported_once FROM datasets ORDER BY id")).rows;
    records = (await readTransaction.execute("SELECT id,dataset_id,row_data FROM records ORDER BY id")).rows;
    sequences = (await readTransaction.execute("SELECT name,seq FROM sqlite_sequence ORDER BY name")).rows;
    await readTransaction.commit();
  } catch (error) {
    try { await readTransaction.rollback(); } catch (_) {}
    throw error;
  }

  const backup = new Database(backupPath);
  try {
    backup.exec(`
      CREATE TABLE datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        filename TEXT NOT NULL,
        sheet_name TEXT,
        reference_period TEXT,
        extracted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        row_count INTEGER DEFAULT 0,
        imported_once INTEGER DEFAULT 0
      );
      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        row_data TEXT NOT NULL
      );
      CREATE INDEX idx_records_dataset ON records(dataset_id);
    `);
    const insertDataset = backup.prepare("INSERT INTO datasets(id,category,source,filename,sheet_name,reference_period,extracted_at,row_count,imported_once) VALUES(?,?,?,?,?,?,?,?,?)");
    const insertRecord = backup.prepare("INSERT INTO records(id,dataset_id,row_data) VALUES(?,?,?)");
    const copy = backup.transaction(() => {
      for (const row of datasets) {
        insertDataset.run(Number(row.id), row.category, row.source, row.filename, row.sheet_name, row.reference_period, row.extracted_at, Number(row.row_count), Number(row.imported_once || 0));
      }
      for (const row of records) insertRecord.run(Number(row.id), Number(row.dataset_id), row.row_data);
      const updateSequence = backup.prepare("UPDATE sqlite_sequence SET seq=? WHERE name=?");
      const insertSequence = backup.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)");
      for (const row of sequences) {
        const result = updateSequence.run(Number(row.seq), row.name);
        if (!result.changes) insertSequence.run(row.name, Number(row.seq));
      }
    });
    copy();
  } finally {
    backup.close();
    try { fs.chmodSync(backupPath, 0o600); } catch (_) {}
  }
}

async function createImportBackup() {
  const backupPath = createImportBackupPath();
  const directory = path.dirname(backupPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (databaseBackend === "sqlite") {
    const source = new Database(databasePath, { fileMustExist: true, readonly: true });
    try { await source.backup(backupPath); }
    finally { source.close(); }
    fs.chmodSync(backupPath, 0o600);
  } else {
    await exportRemoteBackup(backupPath);
  }
  return backupPath;
}

app.post("/api/import", (req, res, next) => {
  if (setupMode || !db) {
    return res.status(503).json({ error: setupMessage, setup: true });
  }
  if (!adminToken) {
    return res.status(503).json({ error: "Importação desativada: configure ADMIN_TOKEN no ambiente do servidor." });
  }
  if (req.headers["x-admin-token"] !== adminToken) {
    return res.status(401).json({ error: "Token administrativo inválido." });
  }
  next();
}, upload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Selecione um arquivo." });
  try {
    const backupPath = await createImportBackup();
    console.log(`Backup anterior à importação criado em armazenamento local: ${backupPath}`);
    const result = await importDataset(req.file.path, req.file.originalname, String(req.body.category || "Não categorizado"), String(req.body.source || "Fonte não informada"), String(req.body.period || ""));
    fs.unlinkSync(req.file.path);
    res.json({ message: "Importação concluída.", ...result });
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    const safeMessage = error.message && /formato|cabeçalho|selecione|não foi encontrado/i.test(error.message)
      ? error.message
      : "Não foi possível concluir a importação. Nenhuma alteração parcial foi mantida.";
    res.status(400).json({ error: safeMessage });
  }
}));

app.get("/api/health", (_req, res) => {
  if (setupMode || !db) {
    return res.json({ status: "setup", setup: true, database: "not_loaded", message: setupMessage });
  }
  res.json({ status: "ok", setup: false, database: databaseBackend });
});
app.get("/api/citizen/units", requireDatabase, asyncRoute(async (req, res) => {
  const district = norm(req.query.district || "");
  const unitType = norm(req.query.type || "");
  const service = norm(req.query.service || "");
  const datasetResult = await db.execute({
    sql: "SELECT id FROM datasets WHERE category=? AND filename=? ORDER BY id DESC LIMIT 1",
    args: ["Estabelecimentos de saúde", "estabelecimentos-310620.csv"]
  });
  const dataset = datasetResult.rows[0];
  if (!dataset) return res.json({ districts: [], types: [], services: [], units: [] });
  const records = await db.execute({ sql: "SELECT row_data FROM records WHERE dataset_id=? ORDER BY id", args: [dataset.id] });
  const rows = records.rows.map(x => safeRow(JSON.parse(x.row_data)));
  const districts = [...new Set(rows.map(r => String(r.BAIRRO || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const patterns = {
    UBS: /\bubs\b|unidade basica|unidade básica|centro de saude|centro de saúde/i,
    UPA: /\bupa\b|pronto atendimento/i,
    Hospital: /hospital|hospitalar/i,
    SAMU: /samu|servico de atendimento movel|serviço de atendimento móvel/i,
    Odontologia: /odont/i,
    Farmácia: /farmacia|farmácia/i
  };
  const labelFor = text => {
    const haystack = `${text["NOME FANTASIA"] || ""} ${text["RAZAO SOCIAL"] || ""}`;
    const types = Object.keys(patterns).filter(key => ["UBS", "UPA", "Hospital", "SAMU", "Farmácia"].includes(key) && patterns[key].test(haystack));
    const services = Object.keys(patterns).filter(key => ["Odontologia", "Farmácia"].includes(key) && patterns[key].test(haystack));
    return { types, services };
  };

  let filtered = rows;
  if (district) filtered = filtered.filter(r => norm(r.BAIRRO) === district);
  if (unitType) filtered = filtered.filter(r => labelFor(r).types.some(v => norm(v) === unitType));
  if (service) filtered = filtered.filter(r => labelFor(r).services.some(v => norm(v) === service));

  const units = filtered.map(r => {
    const latRaw = String(r.LATITUDE ?? "").trim().replace(",", ".");
    const lonRaw = String(r.LONGITUDE ?? "").trim().replace(",", ".");
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    const validCoordinate = latRaw !== "" && lonRaw !== "" &&
      Number.isFinite(lat) && Number.isFinite(lon) &&
      lat !== 0 && lon !== 0 &&
      lat >= -20.10 && lat <= -19.65 &&
      lon >= -44.20 && lon <= -43.75;
    const labels = labelFor(r);
    return {
      name: r["NOME FANTASIA"] || r["RAZAO SOCIAL"] || "",
      type: r["TIPO GESTAO"] || "",
      unitTypes: labels.types,
      namedServices: labels.services,
      district: r.BAIRRO || "",
      address: [r.LOGRADOURO, r.NUMERO].filter(Boolean).join(", "),
      cep: r.CEP || "",
      lat: validCoordinate ? String(lat) : "",
      lon: validCoordinate ? String(lon) : "",
      cnes: r.CNES || ""
    };
  }).filter(r => r.name);

  const types = ["UBS", "UPA", "Hospital", "SAMU", "Farmácia"]
    .map(label => ({ label, count: units.filter(u => u.unitTypes.includes(label)).length }))
    .filter(item => item.count > 0);
  const services = ["Odontologia", "Farmácia"]
    .map(label => ({ label, count: units.filter(u => u.namedServices.includes(label)).length }))
    .filter(item => item.count > 0);
  res.json(jsonSafe({ districts, types, services, units, warning: "Os tipos e serviços são identificados por termos presentes no cadastro nominal. Isso não confirma todos os serviços efetivamente oferecidos pela unidade." }));
}));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? "O arquivo excede o limite de 30 MiB." : "Não foi possível receber o arquivo enviado." });
  }
  const code = error && error.code ? String(error.code) : "unknown";
  console.error(`Falha ao atender solicitação (${code}).`);
  res.status(500).json({ error: "Falha interna ao consultar o sistema." });
});

async function startServer({ port = process.env.PORT || 3000, host = "0.0.0.0" } = {}) {
  if (setupMode) {
    console.log(`SUS+ em modo de preparação. ${setupMessage}`);
    console.log(`UPLOAD_DIR não será criado nem validado durante a preparação: ${uploadDirectory}`);
  } else {
    const opened = await openConfiguredDatabase({ setupMode, env: process.env });
    db = opened.client;
    databaseBackend = opened.backend;
    console.log(`Banco ${databaseBackend} carregado (${opened.counts.datasetCount} conjuntos, ${opened.counts.recordCount} registros).`);
    try {
      prepareUploadDirectory(uploadDirectory);
    } catch (error) {
      db.close();
      db = null;
      throw new Error(`UPLOAD_DIR inválido (${uploadDirectory}): ${error.message}. Verifique a montagem e as permissões do armazenamento.`);
    }
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.log(`SUS+ disponível na porta ${server.address().port} (${host})`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error(`Inicialização interrompida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
