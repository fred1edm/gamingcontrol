import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../apps/api/src/app.ts";
import { createDb } from "../apps/api/src/db.ts";
const db = createDb("postgresql://unused:unused@127.0.0.1:59999/unused_test");
const app = await buildApp(db, {
  secret: "unit-test-secret-with-at-least-32-characters",
  origin: "http://localhost:5173",
  logger: false,
});
await test("API rechaza acceso anónimo sin consultar base de datos", async () => {
  const response = await app.inject({ method: "GET", url: "/stations" });
  assert.equal(response.statusCode, 401);
});
await test("API valida login antes de consultar base de datos", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "no-es-correo", password: "" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ message: string }>().message, "Datos inválidos");
});
await test("API rechaza JWT alterado", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/users",
    headers: { authorization: "Bearer invalid.token.value" },
  });
  assert.equal(response.statusCode, 401);
});
await test("CORS autoriza solo el origen configurado", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/stations",
    headers: {
      origin: "http://untrusted.local",
      "access-control-request-method": "POST",
    },
  });
  assert.notEqual(
    response.headers["access-control-allow-origin"],
    "http://untrusted.local",
  );
});
await test("configuración rechaza secreto JWT corto", async () => {
  await assert.rejects(
    () => buildApp(db, { secret: "short", origin: "http://localhost:5173" }),
    /32/,
  );
});
await app.close();
await db.$disconnect();
