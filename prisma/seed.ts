import "dotenv/config";
import { createDb } from "../apps/api/src/db.ts";
import { hashPassword } from "../apps/api/src/auth.ts";
const db = createDb();
try {
  const email = process.env.ADMIN_EMAIL?.toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Configura ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres)",
    );
  await db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Administrador",
      role: "ADMIN",
      passwordHash: await hashPassword(password),
    },
  });
  for (const [name, type, hourlyCents] of [
    ["PLAY 01", "PS5", 800],
    ["PLAY 02", "PS5", 800],
    ["PLAY 03", "PS4", 400],
    ["PC 01", "PC", 400],
    ["PC 02", "PC", 400],
  ] as const) {
    await db.station.upsert({
      where: { name },
      update: {},
      create: { name, type, rates: { create: { hourlyCents } } },
    });
  }
  await db.extra.upsert({
    where: { name: "Mando adicional" },
    update: {},
    create: { name: "Mando adicional", priceCents: 200 },
  });
  for (const [key, value] of [
    ["ALERT_FIRST_MINUTES", "10"],
    ["ALERT_SECOND_MINUTES", "5"],
    ["NOTIFICATION_SOUND", "fahhhhh"],
  ] as const) {
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
  for (const [name, salePriceCents, costCents] of [
    ["Gaseosa", 300, 150],
    ["Keke", 200, 100],
    ["Agua", 200, 80],
    ["CANCHITA", 250, 120],
  ] as const) {
    await db.product.upsert({
      where: { name },
      update: {},
      create: {
        name,
        salePriceCents,
        costCents,
        stockMinimum: 2,
        stockCurrent: 0,
      },
    });
  }
  console.log("Seed completado; los datos existentes no fueron sobrescritos.");
} finally {
  await db.$disconnect();
}
