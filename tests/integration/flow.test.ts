import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "../../apps/api/src/db.ts";
import { buildApp } from "../../apps/api/src/app.ts";
import { hashPassword } from "../../apps/api/src/auth.ts";
import type { SessionView, StationView } from "@gaming/shared";
// This suite creates only records prefixed TEST-. It never clears a database.
// Require a distinct test database; run migrations before this suite.
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL obligatorio: usa una base de pruebas aislada",
  );
if (!new URL(url).pathname.endsWith("_test"))
  throw new Error("La base de integración debe terminar en _test");
const db = createDb(url);
const app = await buildApp(db, {
  secret: "integration-only-secret-at-least-32-characters",
  origin: "http://localhost:5173",
  logger: false,
});
const tag = randomUUID().slice(0, 8),
  password = "integration-password-123";
let token = "",
  employeeToken = "",
  stationId = "",
  extraId = "",
  sessionId = "",
  productId = "",
  loyaltyCardId = "",
  loyaltyFreeSessionId = "";
function write(
  path: string,
  body: unknown,
  key = randomUUID(),
  auth = token,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST",
) {
  return app.inject({
    method,
    url: path,
    payload: body as Record<string, unknown>,
    headers: { authorization: `Bearer ${auth}`, "idempotency-key": key },
  });
}
function read(path: string, auth = token) {
  return app.inject({
    method: "GET",
    url: path,
    headers: { authorization: `Bearer ${auth}` },
  });
}
function remove(path: string, auth = token) {
  return app.inject({
    method: "DELETE",
    url: path,
    headers: {
      authorization: `Bearer ${auth}`,
      "idempotency-key": randomUUID(),
    },
  });
}
await test("flujo PostgreSQL real y regresiones financieras", async (t) => {
  await t.test("preparación y login", async () => {
    await db.user.create({
      data: {
        email: `${tag}@test.local`,
        name: `TEST-${tag}`,
        role: "ADMIN",
        passwordHash: await hashPassword(password),
      },
    });
    const login = await write("/auth/login", {
      email: `${tag}@test.local`,
      password,
    });
    assert.equal(login.statusCode, 200);
    token = login.json<{ token: string }>().token;
    const employee = await write("/users", {
      email: `employee-${tag}@test.local`,
      name: "TEST Employee",
      password,
      role: "EMPLOYEE",
    });
    assert.equal(employee.statusCode, 200);
    employeeToken = (
      await write("/auth/login", {
        email: `employee-${tag}@test.local`,
        password,
      })
    ).json<{ token: string }>().token;
    const station = await write("/stations", {
      name: `TEST-PLAY-${tag}`,
      type: "PS5",
      hourlyCents: 800,
    });
    assert.equal(station.statusCode, 200);
    stationId = station.json<{ id: string }>().id;
    extraId = (
      await write("/extras", { name: `TEST-Mando-${tag}`, priceCents: 200 })
    ).json<{ id: string }>().id;
  });
  await t.test(
    "sin login y sin permiso se rechazan operaciones sensibles",
    async () => {
      assert.equal(
        (await app.inject({ method: "GET", url: "/stations" })).statusCode,
        401,
      );
      assert.equal(
        (
          await write(
            "/stations",
            { name: "Denied", type: "PC", hourlyCents: 200 },
            randomUUID(),
            employeeToken,
          )
        ).statusCode,
        403,
      );
      assert.equal((await read("/audit", employeeToken)).statusCode, 403);
    },
  );
  await t.test("configuración de avisos solo para ADMIN", async () => {
    const before = await read("/settings");
    assert.equal(before.statusCode, 200);
    assert.ok(
      (before.json<Record<string, number>>().ALERT_FIRST_MINUTES ?? 0) >= 1,
    );
    const updated = await write(
      "/settings",
      { key: "ALERT_FIRST_MINUTES", value: 12 },
      randomUUID(),
      token,
      "PUT",
    );
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.json(), { key: "ALERT_FIRST_MINUTES", value: 12 });
    assert.equal(
      (
        await write(
          "/settings",
          { key: "ALERT_SECOND_MINUTES", value: 6 },
          randomUUID(),
          employeeToken,
          "PUT",
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await read("/settings")).json<Record<string, number>>()
        .ALERT_FIRST_MINUTES,
      12,
    );
    const soundUpdated = await write(
      "/settings",
      { key: "NOTIFICATION_SOUND", value: "game-over-v2" },
      randomUUID(),
      token,
      "PUT",
    );
    assert.equal(soundUpdated.statusCode, 200);
    assert.deepEqual(soundUpdated.json(), {
      key: "NOTIFICATION_SOUND",
      value: "game-over-v2",
    });
    assert.equal(
      (await read("/settings")).json<Record<string, number | string>>()
        .NOTIFICATION_SOUND,
      "game-over-v2",
    );
    const soundRestored = await write(
      "/settings",
      { key: "NOTIFICATION_SOUND", value: "fahhhhh" },
      randomUUID(),
      token,
      "PUT",
    );
    assert.equal(soundRestored.statusCode, 200);
  });
  await t.test("fidelización: seis sellos dan hora y doce dan kit", async () => {
    const loyaltyStation = (
      await write("/stations", {
        name: `TEST-LOYALTY-PC-${tag}`,
        type: "PC",
        hourlyCents: 400,
      })
    ).json<{ id: string }>();
    const created = await write(
      "/loyalty/cards",
      { customerName: `TEST Cliente ${tag}` },
      randomUUID(),
      employeeToken,
    );
    assert.equal(created.statusCode, 200);
    loyaltyCardId = created.json<{ id: string }>().id;
    const first = await write(
      `/loyalty/cards/${loyaltyCardId}/stamps`,
      { quantity: 6 },
      randomUUID(),
      employeeToken,
    );
    assert.equal(first.statusCode, 200);
    assert.equal(first.json<{ stampCount: number; freeHourAvailable: boolean }>().stampCount, 6);
    assert.equal(first.json<{ freeHourAvailable: boolean }>().freeHourAvailable, true);
    assert.equal(
      (
        await write(
          `/loyalty/cards/${loyaltyCardId}/stamps`,
          { quantity: 1 },
          randomUUID(),
          employeeToken,
        )
      ).statusCode,
      409,
    );
    const free = await write(
      `/loyalty/cards/${loyaltyCardId}/redeem`,
      { rewardType: "FREE_HOUR", stationId: loyaltyStation.id },
      randomUUID(),
      employeeToken,
    );
    assert.equal(free.statusCode, 200);
    assert.equal(free.json<{ freeHourAvailable: boolean }>().freeHourAvailable, false);
    loyaltyFreeSessionId = free.json<{ freeSessionId: string }>().freeSessionId;
    const second = await write(
      `/loyalty/cards/${loyaltyCardId}/stamps`,
      { quantity: 6 },
      randomUUID(),
      employeeToken,
    );
    assert.equal(second.statusCode, 200);
    assert.equal(second.json<{ stampCount: number; snackKitAvailable: boolean }>().stampCount, 12);
    assert.equal(second.json<{ snackKitAvailable: boolean }>().snackKitAvailable, true);
    const soda = (
      await write(
        "/products",
        {
          name: `TEST-Gaseosa-Kit-${tag}`,
          category: "BEVERAGE",
          salePriceCents: 300,
          costCents: 150,
          stockMinimum: 0,
          active: true,
        },
        randomUUID(),
        token,
      )
    ).json<{ id: string }>();
    const snackProduct = (
      await write(
        "/products",
        {
          name: `TEST-Snack-Kit-${tag}`,
          category: "SNACK",
          salePriceCents: 200,
          costCents: 100,
          stockMinimum: 0,
          active: true,
        },
        randomUUID(),
        token,
      )
    ).json<{ id: string }>();
    for (const product of [soda, snackProduct]) {
      const stock = await write(
        `/products/${product.id}/stock`,
        { type: "PURCHASE", quantity: 1 },
        randomUUID(),
        token,
      );
      assert.equal(stock.statusCode, 200);
    }
    const snack = await write(
      `/loyalty/cards/${loyaltyCardId}/redeem`,
      {
        rewardType: "SNACK_KIT",
        sodaProductId: soda.id,
        snackProductId: snackProduct.id,
      },
      randomUUID(),
      employeeToken,
    );
    assert.equal(snack.statusCode, 200);
    assert.equal(snack.json<{ stampCount: number }>().stampCount, 0);
    assert.deepEqual(snack.json<{ kit: { soda: string; snack: string } }>().kit, {
      soda: `TEST-Gaseosa-Kit-${tag}`,
      snack: `TEST-Snack-Kit-${tag}`,
    });
    const finishedFree = await write(
      `/sessions/${loyaltyFreeSessionId}/finish`,
      {},
      randomUUID(),
      employeeToken,
    );
    assert.equal(finishedFree.statusCode, 200);
    assert.equal(finishedFree.json<{ status: string }>().status, "CLOSED");
    assert.equal((await read("/loyalty/cards", employeeToken)).statusCode, 200);
  });
  await t.test("tarjetas permiten editar nombre y desactivar sin borrar historial", async () => {
    const updated = await write(
      `/loyalty/cards/${loyaltyCardId}`,
      { customerName: `TEST Cliente Editado ${tag}` },
      randomUUID(),
      employeeToken,
      "PATCH",
    );
    assert.equal(updated.statusCode, 200);
    assert.equal(
      updated.json<{ customerName: string }>().customerName,
      `TEST Cliente Editado ${tag}`,
    );
    const removed = await write(
      `/loyalty/cards/${loyaltyCardId}`,
      {},
      randomUUID(),
      employeeToken,
      "DELETE",
    );
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.json<{ active: boolean }>().active, false);
    const activeCards = (await read("/loyalty/cards", employeeToken)).json<
      { id: string }[]
    >();
    assert.equal(activeCards.some((card) => card.id === loyaltyCardId), false);
    assert.equal(
      await db.loyaltyRedemption.count({ where: { cardId: loyaltyCardId } }),
      2,
    );
  });
  await t.test(
    "ADMIN puede editar trabajadores y restablecer contraseñas",
    async () => {
      const updated = await write(
        `/users/${
          (
            await db.user.findUniqueOrThrow({
              where: { email: `employee-${tag}@test.local` },
              select: { id: true },
            })
          ).id
        }`,
        {
          name: "TEST Employee Editado",
          email: `employee-edit-${tag}@test.local`,
          role: "EMPLOYEE",
        },
        randomUUID(),
        token,
        "PATCH",
      );
      assert.equal(updated.statusCode, 200);
      const userId = updated.json<{ id: string }>().id;
      const reset = await write(
        `/users/${userId}/password`,
        { password: "integration-password-456" },
        randomUUID(),
        token,
        "PUT",
      );
      assert.equal(reset.statusCode, 200);
      const login = await write("/auth/login", {
        email: `employee-edit-${tag}@test.local`,
        password: "integration-password-456",
      });
      assert.equal(login.statusCode, 200);
      employeeToken = login.json<{ token: string }>().token;
    },
  );
  await t.test("los mandos solo se ofrecen para consolas", async () => {
    const pc = (
      await write("/stations", {
        name: `TEST-PC-${tag}`,
        type: "PC",
        hourlyCents: 400,
      })
    ).json<{ id: string }>();
    const result = await write("/sessions", {
      stationId: pc.id,
      mode: "FIXED",
      minutes: 60,
      extraId,
    });
    assert.equal(result.statusCode, 400);
    assert.equal(await db.session.count({ where: { stationId: pc.id } }), 0);
  });
  await t.test(
    "iniciar 1 hora, agregar mandos en varias tandas y limitar a cuatro",
    async () => {
      const start = await write(
        "/sessions",
        { stationId, mode: "FIXED", minutes: 60 },
        randomUUID(),
        employeeToken,
      );
      assert.equal(start.statusCode, 200);
      sessionId = start.json<SessionView>().id;
      assert.equal(start.json<SessionView>().totalAmount, 800);
      const key = randomUUID(),
        body = { extraId, quantity: 1 };
      const added = await write(
        `/sessions/${sessionId}/extras`,
        body,
        key,
        employeeToken,
      );
      assert.equal(added.json<SessionView>().totalAmount, 1000);
      const retry = await write(
        `/sessions/${sessionId}/extras`,
        body,
        key,
        employeeToken,
      );
      assert.deepEqual(retry.json(), added.json());
      const addedAgain = await write(
        `/sessions/${sessionId}/extras`,
        { extraId, quantity: 2 },
        randomUUID(),
        employeeToken,
      );
      assert.equal(addedAgain.statusCode, 200);
      assert.equal(addedAgain.json<SessionView>().totalAmount, 1400);
      assert.equal(addedAgain.json<SessionView>().extras[0]?.quantity, 3);
      assert.equal(
        (
          await write(
            `/sessions/${sessionId}/extras`,
            { extraId, quantity: 2 },
            randomUUID(),
            employeeToken,
          )
        ).statusCode,
        409,
      );
    },
  );
  await t.test("segunda sesión sobre estación ocupada rechazada", async () => {
    assert.equal(
      (await write("/sessions", { stationId, mode: "FIXED", minutes: 60 }))
        .statusCode,
      409,
    );
  });
  await t.test(
    "extender 1 hora: conserva mandos acumulados y snapshot de precios",
    async () => {
      const key = randomUUID();
      const result = await write(
        `/sessions/${sessionId}/extend`,
        { minutes: 60 },
        key,
        employeeToken,
      );
      assert.equal(result.statusCode, 200);
      assert.equal(result.json<SessionView>().totalAmount, 2200);
      assert.equal(result.json<SessionView>().extras.length, 1);
      assert.deepEqual(
        (
          await write(
            `/sessions/${sessionId}/extend`,
            { minutes: 60 },
            key,
            employeeToken,
          )
        ).json(),
        result.json(),
      );
      assert.equal(
        (
          await write(
            `/sessions/${sessionId}/extend`,
            { minutes: 30 },
            key,
            employeeToken,
          )
        ).statusCode,
        409,
      );
      const beforeAdjustment = result.json<SessionView>();
      const extensionId = beforeAdjustment.extensions[0]!.id;
      const adjustment = await write(
        `/sessions/${sessionId}/extensions/${extensionId}/adjust`,
        { minutes: 30 },
        randomUUID(),
        employeeToken,
      );
      assert.equal(adjustment.statusCode, 200);
      assert.equal(adjustment.json<SessionView>().totalAmount, 1800);
      assert.equal(adjustment.json<SessionView>().extensions[0]?.minutesAdded, 30);
      assert.equal(adjustment.json<SessionView>().extensions[0]?.amount, 400);
      assert.equal(
        Date.parse(adjustment.json<SessionView>().endsAt!) -
          Date.parse(beforeAdjustment.endsAt!),
        -30 * 60_000,
      );
      const smallerAdjustment = await write(
        `/sessions/${sessionId}/extensions/${extensionId}/adjust`,
        { minutes: 15 },
        randomUUID(),
        employeeToken,
      );
      assert.equal(smallerAdjustment.statusCode, 200);
      assert.equal(smallerAdjustment.json<SessionView>().totalAmount, 1600);
      assert.equal(smallerAdjustment.json<SessionView>().extensions[0]?.minutesAdded, 15);
      assert.equal(await db.sessionExtensionAdjustment.count({ where: { extensionId } }), 2);
      await write(`/stations/${stationId}/rates`, { hourlyCents: 2000 });
      await write(
        `/extras/${extraId}`,
        { name: `TEST-Mando-${tag}`, priceCents: 500, active: true },
        randomUUID(),
        token,
        "PATCH",
      );
      const current = (
        await read(`/sessions/${sessionId}`)
      ).json<SessionView>();
      assert.equal(current.totalAmount, 1600);
      assert.equal(current.hourlyCents, 800);
      assert.equal(current.extras[0]?.unitPrice, 200);
    },
  );
  await t.test(
    "venta vinculada a sesión descuenta stock y conserva snapshot",
    async () => {
      productId = (
        await write("/products", {
          name: `TEST-Gaseosa-${tag}`,
          salePriceCents: 300,
          stockMinimum: 1,
          costCents: 150,
          active: true,
        })
      ).json<{ id: string }>().id;
      assert.equal(
        (
          await write(`/products/${productId}/stock`, {
            type: "PURCHASE",
            quantity: 3,
            unitCostCents: 150,
          })
        ).statusCode,
        200,
      );
      const sale = await write(
        `/sessions/${sessionId}/products`,
        { items: [{ productId, quantity: 1 }] },
        randomUUID(),
        employeeToken,
      );
      assert.equal(sale.statusCode, 200);
      assert.equal(sale.json<{ totalCents: number }>().totalCents, 300);
      assert.equal(
        (await read(`/sessions/${sessionId}`)).json<SessionView>().totalAmount,
        1900,
      );
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: productId } }))
          .stockCurrent,
        2,
      );
      const item = await db.saleItem.findFirstOrThrow({ where: { productId } });
      assert.deepEqual(
        { name: item.productName, price: item.unitPriceCents },
        { name: `TEST-Gaseosa-${tag}`, price: 300 },
      );
      assert.equal(
        await db.inventoryMovement.count({ where: { productId } }),
        2,
      );
    },
  );
  await t.test(
    "mover sesión conserva tiempo, mandos y productos",
    async () => {
      const target = (
        await write("/stations", {
          name: `TEST-MOVE-TARGET-${tag}`,
          type: "PS4",
          hourlyCents: 400,
        })
      ).json<{ id: string }>();
      const moved = await write(
        `/sessions/${sessionId}/move`,
        { stationId: target.id },
        randomUUID(),
        employeeToken,
      );
      assert.equal(moved.statusCode, 200);
      const view = moved.json<SessionView>();
      assert.equal(view.stationId, target.id);
      assert.equal(view.baseAmount, 500);
      assert.equal(view.totalAmount, 1900);
      assert.equal(view.extras[0]?.quantity, 3);
      assert.equal(view.sales[0]?.items[0]?.productName, `TEST-Gaseosa-${tag}`);
      const list = (await read("/stations")).json<{
        stations: StationView[];
      }>();
      assert.equal(
        list.stations.find((s) => s.id === stationId)?.status,
        "AVAILABLE",
      );
      assert.equal(
        list.stations.find((s) => s.id === target.id)?.status,
        "IN_USE",
      );
      const otherPc = (
        await write("/stations", {
          name: `TEST-MOVE-PC-OTHER-${tag}`,
          type: "PC",
          hourlyCents: 400,
        })
      ).json<{ id: string }>();
      assert.equal(
        (
          await write(
            `/sessions/${sessionId}/move`,
            { stationId: otherPc.id },
            randomUUID(),
            employeeToken,
          )
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "finalizar congela historial, no cobra ni cierra sin pago",
    async () => {
      const key = randomUUID(),
        finished = await write(
          `/sessions/${sessionId}/finish`,
          {},
          key,
          employeeToken,
        );
      assert.equal(finished.statusCode, 200);
      const s = finished.json<SessionView>();
      assert.equal(s.status, "TIME_FINISHED");
      assert.equal(s.totalAmount, 1900);
      assert.ok(s.finishedAt);
      assert.equal(s.extensions.length, 1);
      assert.deepEqual(
        (
          await write(`/sessions/${sessionId}/finish`, {}, key, employeeToken)
        ).json(),
        s,
      );
      assert.equal(
        (await write(`/sessions/${sessionId}/extend`, { minutes: 60 }))
          .statusCode,
        409,
      );
      const row = await db.session.findUniqueOrThrow({
        where: { id: sessionId },
      });
      assert.equal(row.closedAt, null);
      const list = (await read("/stations")).json<{
        stations: StationView[];
      }>();
      assert.equal(
        list.stations.find((s) => s.id === stationId)?.status,
        "AVAILABLE",
      );
      assert.equal(
        list.stations.find((s) => s.session?.id === sessionId)?.status,
        "FINISHED",
      );
      assert.equal(
        await db.auditLog.count({ where: { entityId: sessionId } }),
        6,
      );
    },
  );
  await t.test(
    "rollback: extra inexistente no deja sesión ni estación ocupada",
    async () => {
      const s = (
        await write("/stations", {
          name: `TEST-ROLLBACK-${tag}`,
          type: "PS5",
          hourlyCents: 400,
        })
      ).json<{ id: string }>();
      assert.equal(
        (
          await write("/sessions", {
            stationId: s.id,
            mode: "FIXED",
            minutes: 60,
            extraId: randomUUID(),
          })
        ).statusCode,
        404,
      );
      assert.equal(await db.session.count({ where: { stationId: s.id } }), 0);
      assert.equal(
        (await db.station.findUniqueOrThrow({ where: { id: s.id } })).status,
        "AVAILABLE",
      );
    },
  );
  await t.test(
    "caja cobra sesión, libera estación e impide doble pago",
    async () => {
      const opened = await write(
        "/cash/open",
        { openingAmount: 1000, shift: "MORNING" },
        randomUUID(),
        token,
      );
      assert.equal(opened.statusCode, 200);
      const paid = await write(
        `/sessions/${sessionId}/pay`,
        { method: "CASH" },
        randomUUID(),
        employeeToken,
      );
      assert.equal(paid.statusCode, 200);
      const row = await db.session.findUniqueOrThrow({
        where: { id: sessionId },
      });
      assert.equal(row.status, "CLOSED");
      assert.ok(row.closedAt);
      assert.equal(
        (await db.station.findUniqueOrThrow({ where: { id: stationId } }))
          .status,
        "AVAILABLE",
      );
      assert.equal(
        (await write(`/sessions/${sessionId}/pay`, { method: "CASH" }))
          .statusCode,
        409,
      );
      const current = (await read("/cash/current", token)).json<{
        register: { expectedAmount: number };
      }>();
      assert.equal(current.register.expectedAmount, 3200);
      const closedMorning = await write(
        "/cash/close",
        { closingAmount: 3200, nextOpeningAmount: 3200 },
        randomUUID(),
        token,
      );
      assert.equal(closedMorning.statusCode, 200);
      assert.equal(
        closedMorning.json<{ expectedAmount: number; difference: number }>()
          .expectedAmount,
        3200,
      );
      const handoff = (await read("/cash/current", token)).json<{
        register: unknown;
        lastClosed: {
          shift: string;
          closingAmount: number;
          nextOpeningAmount: number;
        };
      }>();
      assert.equal(handoff.register, null);
      assert.equal(handoff.lastClosed.shift, "MORNING");
      assert.equal(handoff.lastClosed.closingAmount, 3200);
      assert.equal(handoff.lastClosed.nextOpeningAmount, 3200);
      assert.equal(
        (
          await write(
            "/cash/open",
            { openingAmount: 3200, shift: "AFTERNOON" },
            randomUUID(),
            token,
          )
        )
          .statusCode,
        200,
      );
      const quick = await write(
        "/sales",
        { items: [{ productId, quantity: 1 }] },
        randomUUID(),
        employeeToken,
      );
      assert.equal(quick.statusCode, 200);
      const quickId = quick.json<{ id: string }>().id;
      assert.equal(
        (
          await write(
            `/sales/${quickId}/pay`,
            { method: "YAPE" },
            randomUUID(),
            employeeToken,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (await db.sale.findUniqueOrThrow({ where: { id: quickId } })).status,
        "PAID",
      );
      assert.equal(
        (
          await write(
            "/cash/close",
            { closingAmount: 3200, nextOpeningAmount: 1000 },
            randomUUID(),
            token,
          )
        )
          .statusCode,
        200,
      );
      const closingWithdrawal = await db.cashMovement.findFirst({
        where: { type: "WITHDRAWAL", reason: { contains: "siguiente turno" } },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(closingWithdrawal?.amount, 2200);
      const nextMorning = (await read("/cash/current", token)).json<{
        lastClosed: { shift: string; nextOpeningAmount: number };
      }>();
      assert.equal(nextMorning.lastClosed.shift, "AFTERNOON");
      assert.equal(nextMorning.lastClosed.nextOpeningAmount, 1000);
      assert.equal(
        (
          await write(
            "/cash/open",
            { openingAmount: 1000, shift: "MORNING" },
            randomUUID(),
            token,
          )
        ).statusCode,
        200,
      );
      const reopened = (await read("/cash/current", token)).json<{
        register: { shift: string; openingAmount: number };
      }>();
      assert.equal(reopened.register.shift, "MORNING");
      assert.equal(reopened.register.openingAmount, 1000);
      assert.equal(
        (
          await write(
            "/cash/close",
            { closingAmount: 1000, nextOpeningAmount: 1000 },
            randomUUID(),
            token,
          )
        ).statusCode,
        200,
      );
    },
  );
  await t.test(
    "desactivar recursos con historial conserva las ventas y evita borrado físico",
    async () => {
      const deletedProduct = await remove(`/products/${productId}`);
      assert.equal(deletedProduct.statusCode, 200);
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: productId } }))
          .active,
        false,
      );
      assert.equal(await db.saleItem.count({ where: { productId } }), 2);
      assert.equal(
        (await read("/products"))
          .json<{ id: string }[]>()
          .some((row) => row.id === productId),
        false,
      );
      const restoredProduct = await write("/products", {
        name: `TEST-Gaseosa-${tag}`,
        salePriceCents: 350,
        stockMinimum: 1,
        costCents: 150,
        active: true,
      });
      assert.equal(restoredProduct.statusCode, 200);
      assert.equal(restoredProduct.json<{ id: string }>().id, productId);

      const deletedStation = await remove(`/stations/${stationId}`);
      assert.equal(deletedStation.statusCode, 200);
      assert.equal(
        (await db.station.findUniqueOrThrow({ where: { id: stationId } }))
          .active,
        false,
      );
      assert.equal(
        (await read("/stations"))
          .json<{ stations: StationView[] }>()
          .stations.some((row) => row.id === stationId),
        false,
      );
    },
  );
  await t.test("reportes agrupan cobros, sesiones y productos", async () => {
    const daily = await read("/reports/daily", token);
    assert.equal(daily.statusCode, 200);
    const result = daily.json<{
      totalCents: number;
      sessions: { count: number };
      categories: {
        pcCents: number;
        playstationCents: number;
        extrasCents: number;
        snacksCents: number;
        beveragesCents: number;
      };
      promotions: {
        freeHours: number;
        snackKits: number;
        totalValueCents: number;
      };
      cashControl: {
        cashSalesCents: number;
        digitalSalesCents: number;
        registers: { openingAmountCents: number }[];
      };
      paymentsByMethod: { method: string; amountCents: number }[];
      topProducts: { name: string; quantity: number }[];
    }>();
    assert.ok(result.totalCents >= 2400);
    assert.ok(result.sessions.count >= 1);
    assert.ok(result.categories.snacksCents >= 600);
    assert.equal(
      result.categories.pcCents +
        result.categories.playstationCents +
        result.categories.extrasCents +
        result.categories.snacksCents +
        result.categories.beveragesCents,
      result.totalCents,
    );
    assert.equal(typeof result.categories.pcCents, "number");
    assert.equal(typeof result.categories.playstationCents, "number");
    assert.equal(typeof result.categories.extrasCents, "number");
    assert.equal(typeof result.categories.beveragesCents, "number");
    assert.ok(result.promotions.freeHours >= 1);
    assert.ok(result.promotions.snackKits >= 1);
    assert.ok(result.promotions.totalValueCents > 0);
    assert.ok(result.paymentsByMethod.some((row) => row.method === "CASH"));
    assert.ok(result.paymentsByMethod.some((row) => row.method === "YAPE"));
    assert.ok(result.cashControl.cashSalesCents > 0);
    assert.ok(result.cashControl.digitalSalesCents > 0);
    assert.ok(result.cashControl.registers.every((row) => row.openingAmountCents >= 0));
    assert.ok(
      result.topProducts.some((row) => row.name.startsWith("TEST-Gaseosa-")),
    );
    const weekly = await read(
      "/reports/weekly?date=2026-10-17&shift=morning",
      token,
    );
    assert.equal(weekly.statusCode, 200);
    assert.equal(weekly.json<{ shift: string }>().shift, "morning");
    assert.ok(
      Array.isArray(weekly.json<{ totalsByDay: unknown[] }>().totalsByDay),
    );
    const monthly = await read(
      "/reports/monthly?date=2026-10-17&shift=afternoon",
      token,
    );
    assert.equal(monthly.statusCode, 200);
    assert.ok(
      Array.isArray(monthly.json<{ totalsByWeek: unknown[] }>().totalsByWeek),
    );
    assert.equal(
      (await read("/reports/daily?date=2026-02-30", token)).statusCode,
      400,
    );
    assert.equal((await read("/reports/unknown", token)).statusCode, 400);
  });
  await t.test(
    "auditoría ADMIN devuelve usuario y acepta filtros",
    async () => {
      const all = await read("/audit", token);
      assert.equal(all.statusCode, 200);
      const rows =
        all.json<{ action: string; user: { email: string } | null }[]>();
      assert.ok(rows.length > 0);
      assert.ok(rows.some((row) => row.user?.email === `${tag}@test.local`));
      const filtered = await read("/audit?action=SETTING_CHANGED", token);
      assert.equal(filtered.statusCode, 200);
      assert.ok(
        filtered
          .json<{ action: string }[]>()
          .some((row) => row.action === "SETTING_CHANGED"),
      );
    },
  );
  await t.test("dos inicios concurrentes crean una sola sesión", async () => {
    const s = (
      await write("/stations", {
        name: `TEST-RACE-${tag}`,
        type: "PS5",
        hourlyCents: 800,
      })
    ).json<{ id: string }>();
    const requests = await Promise.all([
      write("/sessions", { stationId: s.id, mode: "FIXED", minutes: 60 }),
      write("/sessions", { stationId: s.id, mode: "FIXED", minutes: 60 }),
    ]);
    assert.deepEqual(requests.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(await db.session.count({ where: { stationId: s.id } }), 1);
  });
  await t.test(
    "tiempo libre se congela al finalizar y no permite extensiones",
    async () => {
      const s = (
        await write("/stations", {
          name: `TEST-OPEN-${tag}`,
          type: "PC",
          hourlyCents: 400,
        })
      ).json<{ id: string }>();
      const opened = (
        await write("/sessions", { stationId: s.id, mode: "OPEN" })
      ).json<SessionView>();
      assert.equal(opened.endsAt, null);
      assert.equal(
        (await write(`/sessions/${opened.id}/extend`, { minutes: 60 }))
          .statusCode,
        409,
      );
      await db.session.update({
        where: { id: opened.id },
        data: { startedAt: new Date(Date.now() - 70 * 60_000) },
      });
      const finished = (
        await write(`/sessions/${opened.id}/finish`, {})
      ).json<SessionView>();
      assert.equal(finished.baseAmount, 500);
      assert.equal(
        (await read(`/sessions/${opened.id}`)).json<SessionView>().totalAmount,
        finished.totalAmount,
      );
    },
  );
  await t.test(
    "pausar, cancelar, prepagar, guardar y reanudar sesiones",
    async () => {
      const openStation = (
        await write("/stations", {
          name: `TEST-OPEN-PAUSE-${tag}`,
          type: "PC",
          hourlyCents: 400,
        })
      ).json<{ id: string }>();
      const openStarted = (
        await write("/sessions", {
          stationId: openStation.id,
          mode: "OPEN",
        })
      ).json<SessionView>();
      await db.session.update({
        where: { id: openStarted.id },
        data: { startedAt: new Date(Date.now() - 70 * 60_000) },
      });
      const openPaused = (
        await write(`/sessions/${openStarted.id}/pause`, {})
      ).json<SessionView>();
      assert.equal(openPaused.status, "PAUSED");
      assert.equal(openPaused.baseAmount, 500);
      assert.equal(openPaused.endsAt, null);
      const openResumed = (
        await write(`/sessions/${openStarted.id}/resume`, {})
      ).json<SessionView>();
      assert.equal(openResumed.status, "ACTIVE");
      assert.equal(openResumed.baseAmount, 500);
      assert.equal(openResumed.endsAt, null);
      assert.equal(
        (await write(`/sessions/${openStarted.id}/cancel`, {})).statusCode,
        400,
      );
      const cancelledOpen = (
        await write(`/sessions/${openStarted.id}/cancel`, {
          reason: "Cliente se retiró antes de terminar",
        })
      ).json<SessionView>();
      assert.equal(cancelledOpen.status, "CANCELLED");
      assert.equal(
        cancelledOpen.cancelReason,
        "Cliente se retiró antes de terminar",
      );

      const station = (
        await write("/stations", {
          name: `TEST-CONTROLS-${tag}`,
          type: "PS4",
          hourlyCents: 400,
        })
      ).json<{ id: string }>();
      const started = (
        await write("/sessions", {
          stationId: station.id,
          mode: "FIXED",
          minutes: 60,
        })
      ).json<SessionView>();
      const paused = (
        await write(`/sessions/${started.id}/pause`, {})
      ).json<SessionView>();
      assert.equal(paused.status, "PAUSED");
      assert.ok((paused.pausedRemainingSeconds ?? 0) > 0);
      const resumed = (
        await write(`/sessions/${started.id}/resume`, {})
      ).json<SessionView>();
      assert.equal(resumed.status, "ACTIVE");
      assert.equal(
        (
          await write(`/sessions/${started.id}/cancel`, {
            reason: "Se eligió la estación equivocada",
          })
        ).statusCode,
        200,
      );

      const paidStation = (
        await write("/stations", {
          name: `TEST-SAVED-${tag}`,
          type: "PS5",
          hourlyCents: 500,
        })
      ).json<{ id: string }>();
      if (!(await read("/cash/current")).json<{ register: unknown }>().register)
        await write("/cash/open", { openingAmount: 0 });
      const paidStarted = (
        await write("/sessions", {
          stationId: paidStation.id,
          mode: "FIXED",
          minutes: 60,
        })
      ).json<SessionView>();
      const payment = await write(`/sessions/${paidStarted.id}/prepay`, {
        method: "CASH",
      });
      assert.equal(payment.statusCode, 200);
      assert.equal(
        (await write(`/sessions/${paidStarted.id}/save`, {})).statusCode,
        400,
      );
      const saved = (
        await write(`/sessions/${paidStarted.id}/save`, {
          name: "TEST Cliente",
        })
      ).json<SessionView>();
      assert.equal(saved.status, "SAVED");
      assert.match(saved.savedCode ?? "", /^\d{4}$/);
      assert.equal((await read("/sessions/saved")).statusCode, 200);
      const resumedSaved = (
        await write(`/sessions/${paidStarted.id}/resume`, {})
      ).json<SessionView>();
      assert.equal(resumedSaved.status, "ACTIVE");
      assert.equal(
        (await write(`/sessions/${paidStarted.id}/finish`, {})).statusCode,
        200,
      );
      const cashState = (await read("/cash/current")).json<{
        register: { expectedAmount: number } | null;
      }>();
      if (cashState.register)
        await write("/cash/close", {
          closingAmount: cashState.register.expectedAmount,
        });
    },
  );
  await t.test(
    "ADMIN puede eliminar un trabajador sin borrar su auditoría",
    async () => {
      const employee = await db.user.findUniqueOrThrow({
        where: { email: `employee-edit-${tag}@test.local` },
        select: { id: true },
      });
      const removed = await write(
        `/users/${employee.id}`,
        {},
        randomUUID(),
        token,
        "DELETE",
      );
      assert.equal(removed.statusCode, 200);
      assert.equal(removed.json<{ active: boolean }>().active, false);
      const users = (await read("/users", token)).json<{ id: string }[]>();
      assert.equal(users.some((user) => user.id === employee.id), false);
      assert.equal(
        (
          await write("/auth/login", {
            email: `employee-edit-${tag}@test.local`,
            password: "integration-password-456",
          })
        ).statusCode,
        401,
      );
    },
  );
});
await app.close();
await db.$disconnect();
