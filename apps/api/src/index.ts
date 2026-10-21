import { Server as SocketServer, type Socket } from "socket.io";
import { createDb } from "./db.ts";
import { buildApp } from "./app.ts";
import { events } from "@gaming/shared";

const db = createDb();
const origin = (
  process.env.CORS_ORIGIN ??
  "http://localhost:5173,tauri://localhost,http://tauri.localhost"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const realtime: { io?: SocketServer } = {};
const app = await buildApp(db, {
  secret: process.env.JWT_SECRET ?? "",
  origin,
  emit: (event, payload) => realtime.io?.emit(event, payload),
});

realtime.io = new SocketServer(app.server, {
  cors: { origin, credentials: true },
});
realtime.io.use(async (socket: Socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) throw new Error("missing token");
    const claim = app.jwt.verify<{ sub?: string }>(token);
    if (!claim.sub) throw new Error("missing subject");
    const user = await db.user.findUnique({
      where: { id: claim.sub },
      select: { active: true },
    });
    if (!user?.active) throw new Error("inactive user");
    next();
  } catch {
    next(new Error("No autorizado"));
  }
});

const sentAlerts = new Set<string>();
async function settingMinutes(key: string, fallback: number) {
  const row = await db.setting.findUnique({ where: { key } });
  const value = row ? Number(row.value) : fallback;
  return Number.isFinite(value) && value >= 1 && value <= 120
    ? value
    : fallback;
}
async function finishExpiredSession(session: {
  id: string;
  stationId: string;
  station: { name: string };
  payments: { amountCents: number }[];
  totalAmount: number;
}) {
  const now = new Date();
  const paidAmount = session.payments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  );
  const fullyPaid = paidAmount >= session.totalAmount;
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.session.updateMany({
      where: {
        id: session.id,
        status: { in: ["ACTIVE", "ENDING_SOON"] },
        finishedAt: null,
      },
      data: {
        status: fullyPaid || session.totalAmount === 0 ? "CLOSED" : "TIME_FINISHED",
        finishedAt: now,
        ...(fullyPaid || session.totalAmount === 0 ? { closedAt: now } : {}),
      },
    });
    if (!updated.count) return false;
    await tx.station.updateMany({
      where: { id: session.stationId, status: "IN_USE" },
      data: { status: fullyPaid || session.totalAmount === 0 ? "AVAILABLE" : "FINISHED" },
    });
    return true;
  });
  if (!result) return;
  const payload = {
    sessionId: session.id,
    stationId: session.stationId,
    stationName: session.station.name,
    finishedAt: now.toISOString(),
  };
  realtime.io?.emit(events.sessionFinished, payload);
  realtime.io?.emit(events.notificationNew, {
    id: `${session.id}:finished`,
    type: "SESSION_FINISHED",
    title: "Tiempo terminado",
    message:
      session.totalAmount === 0
        ? `${session.station.name} terminó su hora gratis y quedó disponible.`
        : `${session.station.name} terminó su tiempo y está pendiente de pago.`,
    createdAt: now.toISOString(),
    ...payload,
  });
}
async function scanSessions() {
  const [first, second, sessions] = await Promise.all([
    settingMinutes("ALERT_FIRST_MINUTES", 10),
    settingMinutes("ALERT_SECOND_MINUTES", 5),
    db.session.findMany({
      where: {
        status: { in: ["ACTIVE", "ENDING_SOON"] },
        endsAt: { not: null },
        finishedAt: null,
      },
      include: {
        station: { select: { name: true } },
        payments: { select: { amountCents: true } },
      },
    }),
  ]);
  const activeKeys = new Set<string>();
  const now = Date.now();
  for (const session of sessions) {
    if (!session.endsAt) continue;
    const remainingMs = session.endsAt.getTime() - now;
    const base = {
      sessionId: session.id,
      stationId: session.stationId,
      stationName: session.station.name,
      endsAt: session.endsAt.toISOString(),
    };
    if (remainingMs <= 0) {
      const key = `${session.id}:finished`;
      activeKeys.add(key);
      if (!sentAlerts.has(key)) {
        sentAlerts.add(key);
        try {
          await finishExpiredSession(session);
        } catch (error) {
          sentAlerts.delete(key);
          throw error;
        }
      }
      continue;
    }
    const minutesRemaining =
      remainingMs <= second * 60_000
        ? second
        : remainingMs <= first * 60_000
          ? first
          : null;
    if (minutesRemaining === null) continue;
    const key = `${session.id}:${minutesRemaining === second ? "second" : "first"}`;
    activeKeys.add(key);
    if (sentAlerts.has(key)) continue;
    sentAlerts.add(key);
    const payload = { ...base, minutesRemaining };
    realtime.io?.emit(events.sessionEndingSoon, payload);
    realtime.io?.emit(events.notificationNew, {
      id: key,
      type: "ENDING_SOON",
      title:
        minutesRemaining === second ? "Tiempo por terminar" : "Aviso de tiempo",
      message: `${session.station.name} termina en ${minutesRemaining} minutos.`,
      createdAt: new Date().toISOString(),
      ...payload,
    });
  }
  for (const key of sentAlerts)
    if (!activeKeys.has(key)) sentAlerts.delete(key);
}

const scheduler = setInterval(() => {
  void scanSessions().catch((error) => app.log.error(error, "alert scheduler"));
}, 5_000);
void scanSessions().catch((error) => app.log.error(error, "alert scheduler"));

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(scheduler);
    realtime.io?.close();
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
await app.listen({
  host: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3001),
});
