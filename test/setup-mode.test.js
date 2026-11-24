const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "susmais-setup-mode-"));
const uploadPath = path.join(tempDir, "upload-dir-must-not-exist");
process.env.SUSMAIS_SETUP_MODE = "true";
process.env.DB_BACKEND = "turso";
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
process.env.UPLOAD_DIR = uploadPath;
const { startServer } = require("../server");

test("modo de preparação inicia sem credenciais e responde 503 antes do Multer", async t => {
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "setup");

  for (const endpoint of ["/api/datasets", "/api/search", "/api/dashboard", "/api/citizen/units"]) {
    const response = await fetch(`${base}${endpoint}`);
    assert.equal(response.status, 503, endpoint);
  }

  const importResponse = await fetch(`${base}/api/import`, { method: "POST" });
  assert.equal(importResponse.status, 503);
  assert.equal(fs.existsSync(uploadPath), false);
});
