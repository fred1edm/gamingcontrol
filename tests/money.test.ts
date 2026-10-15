import test from "node:test";
import assert from "node:assert/strict";
import {
  priceForMinutes,
  priceForBlocks,
  priceForOpenMinutes,
  sessionTotal,
  elapsedMinutes,
  elapsedWholeMinutes,
} from "../apps/api/src/money.ts";
import { hashPassword, verifyPassword } from "../apps/api/src/auth.ts";
import { startInput, extendInput, stationInput } from "@gaming/shared";
test("PS5 S/8 + mando S/2 + una hora = S/18, no S/20", () => {
  const base = priceForMinutes(800, 60),
    extras = [{ total: 200 }];
  assert.equal(sessionTotal(base, [], extras), 1000);
  assert.equal(
    sessionTotal(base, [{ amount: priceForMinutes(800, 60) }], extras),
    1800,
  );
});
test("mando múltiple se cobra una vez por sesión, no por extensión", () => {
  assert.equal(
    sessionTotal(
      800,
      [{ amount: 200 }, { amount: 400 }, { amount: 1600 }],
      [{ total: 400 }],
    ),
    3400,
  );
});
test("prorrateo redondea hacia arriba al céntimo", () => {
  assert.equal(priceForMinutes(500, 15), 125);
  assert.equal(priceForMinutes(200, 1), 4);
  assert.equal(priceForMinutes(800, 30), 400);
});
test("dinero inválido se rechaza", () => {
  for (const n of [-1, 1.5, NaN, Infinity])
    assert.throws(() => priceForMinutes(n, 60));
  assert.throws(() => priceForMinutes(Number.MAX_SAFE_INTEGER, 60));
});
test("el tiempo libre se cobra por bloques de 15 minutos", () => {
  const start = new Date("2026-09-06T12:00:00Z");
  assert.equal(elapsedMinutes(start, start), 1);
  assert.equal(elapsedMinutes(start, new Date("2026-09-06T13:00:01Z")), 61);
  assert.equal(priceForBlocks(400, "PC", 1), 100);
  assert.equal(priceForBlocks(400, "PC", 61), 500);
});
test("el tiempo libre da diez minutos de tolerancia después de cada hora", () => {
  assert.equal(elapsedWholeMinutes(new Date("2026-09-06T12:00:00Z"), new Date("2026-09-06T12:24:47Z")), 24);
  assert.equal(priceForOpenMinutes(400, "PC", 0), 100);
  assert.equal(priceForOpenMinutes(400, "PC", 1), 100);
  assert.equal(priceForOpenMinutes(400, "PC", 15), 100);
  assert.equal(priceForOpenMinutes(400, "PC", 24), 200);
  assert.equal(priceForOpenMinutes(400, "PC", 25), 200);
  assert.equal(priceForOpenMinutes(400, "PC", 30), 200);
  assert.equal(priceForOpenMinutes(400, "PC", 45), 300);
  assert.equal(priceForOpenMinutes(400, "PC", 46), 400);
  assert.equal(priceForOpenMinutes(400, "PC", 60), 400);
  assert.equal(priceForOpenMinutes(400, "PC", 62), 400);
  assert.equal(priceForOpenMinutes(400, "PC", 70), 500);
  assert.equal(priceForOpenMinutes(400, "PC", 69), 400);
  assert.equal(priceForOpenMinutes(400, "PC", 123), 800);
  assert.equal(priceForOpenMinutes(400, "PC", 130), 900);
  assert.equal(priceForOpenMinutes(500, "PS5", 69), 500);
  assert.equal(priceForOpenMinutes(500, "PS5", 70), 650);
});
test("cobro por bloques: PC/PS4 y PS5", () => {
  assert.equal(priceForBlocks(400, "PC", 15), 100);
  assert.equal(priceForBlocks(400, "PC", 18), 200);
  assert.equal(priceForBlocks(400, "PS4", 75), 500);
  assert.equal(priceForBlocks(500, "PS5", 15), 150);
  assert.equal(priceForBlocks(500, "PS5", 30), 250);
  assert.equal(priceForBlocks(500, "PS5", 45), 400);
  assert.equal(priceForBlocks(500, "PS5", 60), 500);
  assert.equal(priceForBlocks(500, "PS5", 75), 650);
});
test("esquemas no admiten importes calculados por cliente como fuente financiera", () => {
  assert.equal(
    stationInput.safeParse({ name: "PC 01", type: "PC", hourlyCents: 2.5 })
      .success,
    false,
  );
  assert.equal(extendInput.safeParse({ minutes: 10 }).success, false);
  assert.equal(
    startInput.safeParse({ stationId: crypto.randomUUID(), mode: "FIXED" })
      .success,
    false,
  );
  assert.equal(
    startInput.safeParse({
      stationId: crypto.randomUUID(),
      mode: "OPEN",
      minutes: 60,
    }).success,
    false,
  );
});
test("hash con salt, verificación y contraseña incorrecta", async () => {
  const a = await hashPassword("una-clave-de-prueba"),
    b = await hashPassword("una-clave-de-prueba");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("una-clave-de-prueba", a), true);
  assert.equal(await verifyPassword("incorrecta", a), false);
});
