import "dotenv/config";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { createDb } from "../apps/api/src/db.ts";

if (!process.argv.includes("--confirm")) {
  console.error(
    "Este comando borra datos operativos locales. Repite con --confirm.",
  );
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL es obligatorio");
const url = new URL(databaseUrl);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/gaming_control"
) {
  throw new Error(
    "Por seguridad solo se permite limpiar gaming_control en 127.0.0.1:55432.",
  );
}

const db = createDb(databaseUrl);
try {
  const result = await db.$transaction(async (tx) => {
    const payments = await tx.payment.deleteMany();
    const cashMovements = await tx.cashMovement.deleteMany();
    const cashRegisters = await tx.cashRegister.deleteMany();
    const inventoryMovements = await tx.inventoryMovement.deleteMany();
    const saleItems = await tx.saleItem.deleteMany();
    const sales = await tx.sale.deleteMany();
    const sessionExtras = await tx.sessionExtra.deleteMany();
    const extensions = await tx.sessionExtension.deleteMany();
    const sessions = await tx.session.deleteMany();
    const loyaltyRedemptions = await tx.loyaltyRedemption.deleteMany();
    const loyaltyCards = await tx.loyaltyCard.deleteMany();
    const audit = await tx.auditLog.deleteMany();
    const idempotency = await tx.idempotency.deleteMany();
    const baseStationNames = [
      "PLAY 01",
      "PLAY 02",
      "PLAY 03",
      "PC 01",
      "PC 02",
    ];
    const stations = await tx.station.updateMany({
      where: { name: { in: baseStationNames } },
      data: { active: true, status: "AVAILABLE" },
    });
    await tx.station.updateMany({
      where: { name: { notIn: baseStationNames } },
      data: { active: false, status: "OFFLINE" },
    });
    const baseProductNames = ["Agua", "CANCHITA", "Gaseosa", "Keke"];
    const products = await tx.product.updateMany({
      where: { name: { in: baseProductNames } },
      data: { active: true, stockCurrent: 0 },
    });
    await tx.product.updateMany({
      where: { name: { notIn: baseProductNames } },
      data: { active: false, stockCurrent: 0 },
    });
    await tx.extra.updateMany({
      where: { name: "Mando adicional" },
      data: { active: true },
    });
    await tx.extra.updateMany({
      where: { name: { not: "Mando adicional" } },
      data: { active: false },
    });
    return {
      payments: payments.count,
      cashMovements: cashMovements.count,
      cashRegisters: cashRegisters.count,
      inventoryMovements: inventoryMovements.count,
      saleItems: saleItems.count,
      sales: sales.count,
      sessionExtras: sessionExtras.count,
      extensions: extensions.count,
      sessions: sessions.count,
      loyaltyRedemptions: loyaltyRedemptions.count,
      loyaltyCards: loyaltyCards.count,
      audit: audit.count,
      idempotency: idempotency.count,
      stationsReset: stations.count,
      productsReset: products.count,
    };
  });
  console.log(
    "Limpieza local completada; usuarios y recursos fueron conservados.",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.$disconnect();
}
