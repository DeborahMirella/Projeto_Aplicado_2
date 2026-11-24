const express = require("express");
const multer = require("multer");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");

const app = express();
const databasePath = path.resolve(process.env.SUSMAIS_DB_PATH || path.join(__dirname, "susmais.sqlite"));
const setupMode = String(process.env.SUSMAIS_SETUP_MODE || "").trim().toLowerCase() === "true";
const setupMessage = "Sistema em preparação: o banco de dados ainda não foi disponibilizado. Transfira o SQLite para o caminho configurado e reinicie o serviço com SUSMAIS_SETUP_MODE=false.";
let db = null;
if (setupMode) {
  console.log(`SUS+ em modo de preparação. ${setupMessage}`);
} else {
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Banco SQLite não encontrado em ${databasePath}. Configure SUSMAIS_DB_PATH para um banco existente; um banco vazio não será criado.`);
  }
  db = new Database(databasePath, { fileMustExist: true });
}
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"));
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({ dest: uploadDirectory, limits: { fileSize: 30 * 1024 * 1024 } });
const adminToken = String(process.env.ADMIN_TOKEN || "").trim();
if (!adminToken) {
  console.error("ADMIN_TOKEN não configurado; importações administrativas estão desativadas, inclusive em produção.");
}
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (db) {
  const requiredTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  if (!requiredTables.has("datasets") || !requiredTables.has("records")) {
    db.close();
    throw new Error(`O arquivo em ${databasePath} não contém as tabelas datasets e records esperadas.`);
  }
  const datasetCount = db.prepare("SELECT COUNT(*) AS count FROM datasets").get().count;
  const recordCount = db.prepare("SELECT COUNT(*) AS count FROM records").get().count;
  if (datasetCount === 0 || recordCount === 0) {
    db.close();
    throw new Error(`O banco em ${databasePath} não contém conjuntos e registros. Inicialização interrompida para evitar servir um banco vazio.`);
  }
  console.log(`Banco SQLite carregado: ${databasePath}`);
}

function requireDatabase(_req, res, next) {
  if (setupMode || !db) {
    return res.status(503).json({ error: setupMessage, setup: true });
  }
  next();
}

function norm(v) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}
function forbiddenKey(k) {
  const n = norm(k).replace(/[^a-z0-9]/g, "");
  return /^(cns|cartaosus|matricula|matriculafuncional)$/.test(n);
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

function importDataset(file, originalName, category, source, period) {
  const sheets = parseFile(file, originalName, category, period);
  const resolvedPeriod = period || inferPeriod(category, source, originalName, sheets);
  const insertDataset = db.prepare("INSERT INTO datasets(category,source,filename,sheet_name,reference_period,row_count) VALUES(?,?,?,?,?,?)");
  const insertRecord = db.prepare("INSERT INTO records(dataset_id,row_data) VALUES(?,?)");
  const tx = db.transaction(() => {
    for (const s of sheets) {
      const info = insertDataset.run(category, source, originalName, s.sheet, resolvedPeriod, s.rows.length);
      for (const row of s.rows) insertRecord.run(info.lastInsertRowid, JSON.stringify(row));
    }
  });
  tx();
  return { sheets: sheets.length, rows: sheets.reduce((n, s) => n + s.rows.length, 0) };
}

app.get("/api/datasets", requireDatabase, (_req, res) => {
  res.json(db.prepare("SELECT id,category,source,filename,sheet_name,reference_period,extracted_at,row_count FROM datasets ORDER BY id DESC").all());
});

app.get("/api/search", requireDatabase, (req, res) => {
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
  const rows = db.prepare(sql + " LIMIT 5000").all(...params);
  const matched = rows.filter(rec => {
    const data = JSON.parse(rec.row_data);
    const entries = Object.entries(data).filter(([k]) => !forbiddenKey(k));
    const textOk = !q || entries.some(([k, v]) => norm(k).includes(q) || norm(v).includes(q));
    const checks = filters.map(([field, value]) => entries.some(([k, v]) => norm(k) === norm(field) && norm(v).includes(value)));
    const filterOk = !checks.length || (mode === "any" ? checks.some(Boolean) : checks.every(Boolean));
    return textOk && filterOk;
  });
  res.json(matched.slice(0, 200).map(rec => ({ id: rec.id, ...JSON.parse(rec.row_data), _categoria: rec.category, _fonte: rec.source, _arquivo: rec.filename, _aba: rec.sheet_name, _periodo: rec.reference_period })));
});

app.get("/api/dashboard", requireDatabase, (_req, res) => {
  const all = db.prepare(`SELECT d.category,d.source,d.filename,d.sheet_name,d.reference_period,r.row_data FROM records r JOIN datasets d ON d.id=r.dataset_id`).all();
  const rows = all.map(x => ({ ...x, data: JSON.parse(x.row_data) }));
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
  res.json({
    counts: { establishments: cnes.length, sisab: sisab.length, sia: sia.length, aps: aps.length, acs: acs.length, monitor: monitor.length, professionals: professionalCount },
    acsSeries: acs.map(r => ({ competence: r.data["Comp. CNES"] || "", coverage: r.data["Cobertura ACS"] || "" })).filter(x => x.competence),
    apsSeries: aps.map(r => ({ competence: r.data["Comp. CNES"] || "", capacity: r.data["Qt. capacidade da equipe"] || "" })).filter(x => x.competence),
    sisab: sisab.map(r => r.data),
    sia: sia.map(r => r.data),
    monitor: monitor.map(r => ({ sheet: r.sheet_name, municipality: r.data.Município || r.data.Municipio || "", status: r.data["Situação do envio de produção"] || r.data["Status do envio de produção"] || "", count: r.data["Qtde. de competências consecutivas sem envio"] || "", cnes: r.data.CNES || "" })),
    professionals: professionalRows,
    cboCounts,
    statusCounts
  });
});

function createImportBackupPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.dirname(databasePath);
  const basename = path.basename(databasePath, path.extname(databasePath));
  return path.join(directory, `${basename}.before-import-${timestamp}.sqlite`);
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
}, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Selecione um arquivo." });
    const backupPath = createImportBackupPath();
    await db.backup(backupPath);
    console.log(`Backup de segurança criado antes da importação: ${backupPath}`);
    const result = importDataset(req.file.path, req.file.originalname, String(req.body.category || "Não categorizado"), String(req.body.source || "Fonte não informada"), String(req.body.period || ""));
    fs.unlinkSync(req.file.path);
    res.json({ message: "Importação concluída.", ...result });
  } catch (error) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/health", (_req, res) => {
  if (setupMode || !db) {
    return res.json({ status: "setup", setup: true, database: "not_loaded", message: setupMessage });
  }
  res.json({ status: "ok", setup: false, database: "SQLite" });
});
app.get("/api/citizen/units", requireDatabase, (req, res) => {
  const district = norm(req.query.district || "");
  const unitType = norm(req.query.type || "");
  const service = norm(req.query.service || "");
  const dataset = db.prepare("SELECT id FROM datasets WHERE category=? AND filename=? ORDER BY id DESC LIMIT 1").get("Estabelecimentos de saúde", "estabelecimentos-310620.csv");
  if (!dataset) return res.json({ districts: [], types: [], services: [], units: [] });
  const rows = db.prepare("SELECT row_data FROM records WHERE dataset_id=?").all(dataset.id).map(x => JSON.parse(x.row_data));
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
  res.json({ districts, types, services, units, warning: "Os tipos e serviços são identificados por termos presentes no cadastro nominal. Isso não confirma todos os serviços efetivamente oferecidos pela unidade." });
});
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`SUS+ disponível na porta ${port} (0.0.0.0)`));
