const assert = require("node:assert/strict");
const test = require("node:test");
const { API_ENDPOINTS, compareApis, executeRemote } = require("../scripts/verify-turso-migration");

test("comparador consulta apenas as quatro rotas públicas previstas", async () => {
  const requested = [];
  const sameJson = { ok: true, status: 200, json: async () => ({ stable: [1, 2] }) };
  await compareApis("http://local.test", "http://remote.test", async url => {
    requested.push(url.origin + url.pathname + url.search);
    return sameJson;
  });

  assert.deepEqual(API_ENDPOINTS, [
    "/api/datasets",
    "/api/search?mode=all",
    "/api/dashboard",
    "/api/citizen/units"
  ]);
  assert.equal(requested.length, 8);
  assert.ok(requested.every(url => !url.includes("/api/import")));
});

test("401 HTTP é identificado pelo endpoint sem tentar contornar autenticação", async () => {
  const requested = [];
  await assert.rejects(
    compareApis("http://local.test", "http://remote.test", async url => {
      requested.push(url.pathname + url.search);
      if (url.pathname === "/api/dashboard" && url.origin === "http://remote.test") {
        return { ok: false, status: 401 };
      }
      return { ok: true, status: 200, json: async () => ({ stable: [1, 2] }) };
    }),
    /API \/api\/dashboard retornou HTTP 200 local \/ 401 remoto/
  );
  assert.ok(requested.includes("/api/dashboard"));
  assert.ok(requested.every(url => !url.includes("/api/import")));
});

test("401 do cliente Turso aponta a consulta falha antes da comparação HTTP", async () => {
  const client = {
    execute: async () => {
      const error = new Error("SERVER_ERROR: Server returned HTTP status 401");
      error.code = "SERVER_ERROR";
      throw error;
    }
  };
  await assert.rejects(
    executeRemote(client, "SELECT COUNT(*) AS count FROM datasets", "contagem de conjuntos"),
    error => error.code === "TURSO_AUTH" && /contagem de conjuntos/.test(error.message) && /ainda não começou/.test(error.message)
  );
});
