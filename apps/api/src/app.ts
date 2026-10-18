import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import {
  loginInput,
  userInput,
  userUpdateInput,
  passwordResetInput,
  stationInput,
  rateInput,
  extraInput,
  startInput,
  extendInput,
  addExtraInput,
  productInput,
  stockInput,
  saleInput,
  paymentInput,
  cashOpenInput,
  cashCloseInput,
  cashMovementInput,
  settingInput,
  sessionSaveInput,
  sessionResumeInput,
  sessionMoveInput,
  sessionCancelInput,
  loyaltyStampInput,
  loyaltyCardUpdateInput,
  loyaltyRedeemInput,
  notificationSoundValues,
  events,
  type UserView,
} from "@gaming/shared";
import { hashPassword, verifyPassword } from "./auth.ts";
import {
  elapsedWholeMinutes,
  priceForBlocks,
  priceForOpenMinutes,
  sessionTotal,
} from "./money.ts";

declare module "fastify" {
  interface FastifyRequest {
    actor: UserView | null;
  }
}
class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
const details = {
  extensions: { orderBy: { createdAt: "asc" as const } },
  extras: { orderBy: { createdAt: "asc" as const } },
  sales: { include: { items: { orderBy: { createdAt: "asc" as const } } } },
  payments: {
    select: { id: true, method: true, amountCents: true, createdAt: true },
  },
  station: { select: { name: true, type: true } },
};
type SessionDetail = Prisma.SessionGetPayload<{ include: typeof details }>;
function view(s: SessionDetail, now: Date) {
  const openMeasuredAt =
    s.mode === "OPEN" && s.status === "PAUSED" && s.pausedAt
      ? s.pausedAt
      : s.finishedAt ?? now;
  const base =
    s.mode === "OPEN"
      ? priceForOpenMinutes(
          s.hourlyCents,
          s.station.type,
          elapsedWholeMinutes(s.startedAt, openMeasuredAt),
        )
      : s.baseAmount;
  const expired =
    !["PAUSED", "SAVED", "CLOSED", "CANCELLED"].includes(s.status) &&
    s.endsAt &&
    s.endsAt <= now;
  return {
    ...s,
    baseAmount: base,
    totalAmount:
      sessionTotal(base, s.extensions, s.extras) +
      s.sales.reduce((sum, sale) => sum + sale.totalCents, 0),
    status: ["CLOSED", "CANCELLED"].includes(s.status)
      ? s.status
      : s.finishedAt || expired
        ? "TIME_FINISHED"
        : s.status,
  };
}
function actor(req: FastifyRequest) {
  if (!req.actor) throw new ApiError(401, "Inicia sesión");
  return req.actor;
}
function admin(req: FastifyRequest) {
  if (actor(req).role !== "ADMIN")
    throw new ApiError(403, "Se requiere permiso de administrador");
}
const idOf = (req: FastifyRequest) =>
  z.object({ id: z.string().uuid() }).parse(req.params).id;
const asJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type ReportPeriod = "daily" | "weekly" | "monthly";
type ReportShift = "all" | "morning" | "afternoon";
const REPORT_OFFSET_HOURS = 5;
function reportLocalDate(date?: string, now = new Date()) {
  if (!date) return new Date(now.getTime() - REPORT_OFFSET_HOURS * 60 * 60 * 1000);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new ApiError(400, "La fecha del reporte no es válida");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month, day, 12));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month ||
    candidate.getUTCDate() !== day
  )
    throw new ApiError(400, "La fecha del reporte no es válida");
  return candidate;
}
function reportRange(period: ReportPeriod, date?: string, now = new Date()) {
  const shifted = reportLocalDate(date, now);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  let startDay = day;
  if (period === "monthly") startDay = 1;
  if (period === "weekly") {
    const weekday = shifted.getUTCDay() || 7;
    startDay = day - weekday + 1;
  }
  const from = new Date(Date.UTC(year, month, startDay, 5));
  const to =
    period === "daily"
      ? new Date(from.getTime() + 24 * 60 * 60 * 1000)
      : period === "weekly"
        ? new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)
        : new Date(Date.UTC(year, month + 1, 1, 5));
  return { from, to };
}
function reportShiftMatches(date: Date, shift: ReportShift) {
  if (shift === "all") return true;
  const localHour = new Date(
    date.getTime() - REPORT_OFFSET_HOURS * 60 * 60 * 1000,
  ).getUTCHours();
  return shift === "morning"
    ? localHour >= 10 && localHour < 15
    : localHour >= 15 && localHour < 22;
}
function reportWeekStart(day: string) {
  const parts = day.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const date = parts[2] ?? 1;
  const local = new Date(Date.UTC(year, month - 1, date, 12));
  const weekday = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() - weekday + 1);
  return local.toISOString().slice(0, 10);
}
export async function buildApp(
  db: PrismaClient,
  options: {
    secret: string;
    origin: string | string[];
    logger?: boolean;
    emit?: (event: string, payload: unknown) => void;
  },
) {
  if (options.secret.length < 32)
    throw new Error("JWT_SECRET debe tener al menos 32 caracteres");
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 32768 });
  const emit = options.emit ?? (() => undefined);
  await app.register(cors, { origin: options.origin });
  await app.register(jwt, {
    secret: options.secret,
    sign: { expiresIn: "8h" },
  });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  app.decorateRequest("actor", null);
  app.addHook("onRequest", async (req) => {
    if (
      req.method === "OPTIONS" ||
      req.routeOptions.url === "/health" ||
      req.routeOptions.url === "/auth/login"
    )
      return;
    try {
      await req.jwtVerify();
    } catch {
      throw new ApiError(401, "Tu sesión venció. Inicia sesión nuevamente.");
    }
    const claim = req.user as { sub?: string };
    const user = claim.sub
      ? await db.user.findUnique({
          where: { id: claim.sub },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
          },
        })
      : null;
    if (!user?.active) throw new ApiError(401, "Usuario no disponible");
    req.actor = user;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ message: "Datos inválidos", issues: error.issues });
    if (error instanceof ApiError)
      return reply.code(error.statusCode).send({ message: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002")
        return reply.code(409).send({
          message:
            "Ya existe el registro o la estación tiene una sesión pendiente.",
        });
      if (error.code === "P2025")
        return reply.code(404).send({ message: "Registro no encontrado" });
      if (error.code === "P2034")
        return reply
          .code(409)
          .send({ message: "Conflicto concurrente. Reintenta la operación." });
    }
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ message: error.message });
    req.log.error(error);
    return reply
      .code(500)
      .send({ message: "No se pudo completar la operación" });
  });
  async function audit(
    tx: Prisma.TransactionClient,
    req: FastifyRequest,
    action: string,
    entityType: string,
    entityId: string,
    oldData: unknown,
    newData: unknown,
  ) {
    await tx.auditLog.create({
      data: {
        userId: actor(req).id,
        action,
        entityType,
        entityId,
        oldData: oldData === null ? Prisma.JsonNull : asJson(oldData),
        newData: asJson(newData),
        ipAddress: req.ip,
      },
    });
  }
  async function mutate(
    req: FastifyRequest,
    operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
    event?: string | string[],
  ) {
    const key = z.string().uuid().parse(req.headers["idempotency-key"]);
    const scopedKey = `${actor(req).id}:${key}`;
    const fingerprint = createHash("sha256")
      .update(`${req.method}:${req.url}:${JSON.stringify(req.body ?? {})}`)
      .digest("hex");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await db.$transaction(
          async (tx) => {
            const previous = await tx.idempotency.findUnique({
              where: { key: scopedKey },
            });
            if (previous) {
              if (previous.fingerprint !== fingerprint)
                throw new ApiError(
                  409,
                  "La clave de reintento ya pertenece a otra operación",
                );
              return previous.response;
            }
            const result = asJson(await operation(tx));
            await tx.idempotency.create({
              data: {
                key: scopedKey,
                userId: actor(req).id,
                fingerprint,
                response: result,
              },
            });
            return result;
          },
          { isolationLevel: "Serializable", timeout: 15000 },
        );
        const emitted =
          event ??
          (req.url.includes("/sessions") && req.url.includes("/extend")
            ? events.sessionExtended
            : req.url.includes("/sessions") && req.url.includes("/finish")
              ? events.sessionFinished
              : req.url.includes("/sessions") && req.url.includes("/pay")
                ? events.sessionUpdated
                : req.url.includes("/sessions") && req.url.includes("/products")
                  ? events.saleCreated
                  : req.url === "/sessions"
                    ? events.sessionStarted
                    : req.url.includes("/products") &&
                        req.url.includes("/stock")
                      ? events.inventoryUpdated
                      : req.url.startsWith("/sales")
                        ? events.saleCreated
                        : req.url.startsWith("/settings")
                          ? events.settingsUpdated
                          : req.url.startsWith("/cash")
                            ? events.cashUpdated
                            : req.url.startsWith("/stations")
                              ? events.stationUpdated
                              : undefined);
        if (emitted) {
          for (const eventName of Array.isArray(emitted) ? emitted : [emitted])
            emit(eventName, result);
        }
        return result;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2034", "P2002"].includes(error.code) &&
          attempt < 3
        )
          continue;
        throw error;
      }
    }
    throw new ApiError(409, "Reintenta la operación");
  }
  async function addExtra(
    tx: Prisma.TransactionClient,
    sessionId: string,
    extraId: string,
    quantity: number,
  ) {
    const extra = await tx.extra.findUnique({ where: { id: extraId } });
    if (!extra?.active) throw new ApiError(404, "Extra no disponible");
    const existing = await tx.sessionExtra.findUnique({
      where: { sessionId_extraId: { sessionId, extraId } },
    });
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    if (nextQuantity > 4)
      throw new ApiError(409, "Máximo 4 mandos por sesión");

    // Keep the first unit price as a historical snapshot even if the catalog
    // price changes while the session is active.
    const unitPrice = existing?.unitPrice ?? extra.priceCents;
    const addedTotal = unitPrice * quantity;
    const record = existing
      ? await tx.sessionExtra.update({
          where: { id: existing.id },
          data: {
            quantity: nextQuantity,
            total: unitPrice * nextQuantity,
          },
        })
      : await tx.sessionExtra.create({
          data: {
            sessionId,
            extraId,
            name: extra.name,
            quantity,
            unitPrice,
            total: addedTotal,
            chargeType: extra.chargeType,
          },
        });
    return { ...record, addedTotal };
  }
  async function createSale(
    tx: Prisma.TransactionClient,
    req: FastifyRequest,
    input: {
      sessionId?: string | null;
      items: { productId: string; quantity: number }[];
    },
  ) {
    if (input.sessionId) {
      const target = await tx.session.findUnique({
        where: { id: input.sessionId },
        include: { payments: { select: { id: true } } },
      });
      if (
        !target ||
        ["CLOSED", "CANCELLED", "PAUSED", "SAVED"].includes(target.status)
      )
        throw new ApiError(404, "Sesión no disponible");
      if (target.payments.length)
        throw new ApiError(
          409,
          "La sesión ya fue pagada; no admite nuevos productos",
        );
    }
    const items: {
      productId: string;
      productName: string;
      unitPriceCents: number;
      quantity: number;
      subtotalCents: number;
    }[] = [];
    let totalCents = 0;
    for (const requested of input.items) {
      const product = await tx.product.findUnique({
        where: { id: requested.productId },
      });
      if (!product?.active) throw new ApiError(404, "Producto no disponible");
      if (product.stockCurrent < requested.quantity)
        throw new ApiError(409, `Stock insuficiente para ${product.name}`);
      const subtotalCents = product.salePriceCents * requested.quantity;
      items.push({
        productId: product.id,
        productName: product.name,
        unitPriceCents: product.salePriceCents,
        quantity: requested.quantity,
        subtotalCents,
      });
      totalCents += subtotalCents;
    }
    const sale = await tx.sale.create({
      data: {
        sessionId: input.sessionId ?? null,
        createdBy: actor(req).id,
        totalCents,
        items: { create: items },
      },
      include: { items: true },
    });
    for (const item of items) {
      const product = await tx.product.update({
        where: { id: item.productId },
        data: { stockCurrent: { decrement: item.quantity } },
      });
      await tx.inventoryMovement.create({
        data: {
          productId: product.id,
          type: "SALE",
          quantity: -item.quantity,
          stockBefore: product.stockCurrent + item.quantity,
          stockAfter: product.stockCurrent,
          saleId: sale.id,
          createdBy: actor(req).id,
        },
      });
    }
    if (input.sessionId)
      await tx.session.update({
        where: { id: input.sessionId },
        data: { totalAmount: { increment: totalCents } },
      });
    await audit(tx, req, "SALE_CREATED", "Sale", sale.id, null, sale);
    return sale;
  }
  async function openCash(tx: Prisma.TransactionClient) {
    const register = await tx.cashRegister.findFirst({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    if (!register)
      throw new ApiError(
        409,
        "La caja está cerrada. Abre la caja antes de cobrar.",
      );
    return register;
  }
  async function cashExpected(
    tx: Prisma.TransactionClient,
    registerId: string,
  ) {
    const register = await tx.cashRegister.findUniqueOrThrow({
      where: { id: registerId },
      include: { movements: true },
    });
    return (
      register.openingAmount +
      register.movements
        .filter((m) => m.method === "CASH" && m.type !== "OPENING")
        .reduce(
          (sum, m) => sum + (m.type === "WITHDRAWAL" ? -m.amount : m.amount),
          0,
        )
    );
  }
  async function takePayment(
    tx: Prisma.TransactionClient,
    req: FastifyRequest,
    target: { sessionId?: string; saleId?: string },
    method: "CASH" | "YAPE" | "PLIN" | "CARD" | "TRANSFER" | "OTHER",
  ) {
    const register = await openCash(tx);
    if ((target.sessionId ? 1 : 0) + (target.saleId ? 1 : 0) !== 1)
      throw new ApiError(
        400,
        "El pago debe pertenecer a una sesión o una venta",
      );
    let amountCents: number;
    if (target.sessionId) {
      const session = await tx.session.findUnique({
        where: { id: target.sessionId },
        include: { sales: true },
      });
      if (!session || session.status !== "TIME_FINISHED" || !session.finishedAt)
        throw new ApiError(
          409,
          "La sesión debe estar finalizada antes de cobrar",
        );
      amountCents = session.totalAmount;
      const payment = await tx.payment.create({
        data: {
          sessionId: session.id,
          cashRegisterId: register.id,
          method,
          amountCents,
          createdBy: actor(req).id,
        },
      });
      await tx.session.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: actor(req).id,
        },
      });
      await tx.sale.updateMany({
        where: { sessionId: session.id, status: "OPEN" },
        data: { status: "PAID" },
      });
      await tx.station.update({
        where: { id: session.stationId },
        data: { status: "AVAILABLE" },
      });
      await tx.cashMovement.create({
        data: {
          cashRegisterId: register.id,
          type: "PAYMENT",
          method,
          amount: amountCents,
          paymentId: payment.id,
          createdBy: actor(req).id,
        },
      });
      await audit(tx, req, "SESSION_PAID", "Session", session.id, session, {
        payment,
        amountCents,
      });
      return payment;
    }
    const sale = await tx.sale.findUnique({ where: { id: target.saleId! } });
    if (!sale || sale.status !== "OPEN" || sale.sessionId)
      throw new ApiError(
        409,
        "La venta no está disponible para cobro independiente",
      );
    amountCents = sale.totalCents;
    const payment = await tx.payment.create({
      data: {
        saleId: sale.id,
        cashRegisterId: register.id,
        method,
        amountCents,
        createdBy: actor(req).id,
      },
    });
    await tx.sale.update({ where: { id: sale.id }, data: { status: "PAID" } });
    await tx.cashMovement.create({
      data: {
        cashRegisterId: register.id,
        type: "PAYMENT",
        method,
        amount: amountCents,
        paymentId: payment.id,
        createdBy: actor(req).id,
      },
    });
    await audit(tx, req, "SALE_PAID", "Sale", sale.id, sale, {
      payment,
      amountCents,
    });
    return payment;
  }
  async function session(tx: Prisma.TransactionClient, id: string) {
    const s = await tx.session.findUnique({ where: { id }, include: details });
    if (!s) throw new ApiError(404, "Sesión no encontrada");
    return s;
  }
  async function report(
    period: ReportPeriod,
    date?: string,
    shift: ReportShift = "all",
  ) {
    const { from, to } = reportRange(period, date);
    const [periodPayments, periodRedemptions] = await Promise.all([
      db.payment.findMany({
        where: { createdAt: { gte: from, lt: to } },
        include: {
          session: {
            include: {
              station: { select: { name: true, type: true } },
              extensions: true,
              extras: true,
              sales: { include: { items: true } },
            },
          },
          sale: { include: { items: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.loyaltyRedemption.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: {
          createdAt: true,
          rewardType: true,
          promotionValueCents: true,
          sodaProductName: true,
          snackProductName: true,
        },
      }),
    ]);
    const payments = periodPayments.filter((payment) =>
      reportShiftMatches(payment.createdAt, shift),
    );
    const redemptions = periodRedemptions.filter((redemption) =>
      reportShiftMatches(redemption.createdAt, shift),
    );
    let totalCents = 0,
      sessionRevenueCents = 0,
      pcCents = 0,
      playstationCents = 0,
      extrasCents = 0,
      snacksCents = 0;
    const byMethod = new Map<string, number>(),
      byStation = new Map<string, { name: string; amountCents: number }>(),
      byProduct = new Map<
        string,
        { name: string; quantity: number; amountCents: number }
      >(),
      byHour = new Map<number, number>(),
      byDay = new Map<string, number>(),
      byWeek = new Map<string, number>(),
      sessions = new Map<string, number>();
    const promotions = {
      freeHours: 0,
      snackKits: 0,
      freeHourValueCents: 0,
      snackKitValueCents: 0,
      products: new Map<string, number>(),
    };
    for (const redemption of redemptions) {
      if (redemption.rewardType === "FREE_HOUR") {
        promotions.freeHours += 1;
        promotions.freeHourValueCents += redemption.promotionValueCents;
      } else {
        promotions.snackKits += 1;
        promotions.snackKitValueCents += redemption.promotionValueCents;
        for (const productName of [redemption.sodaProductName, redemption.snackProductName]) {
          if (productName)
            promotions.products.set(productName, (promotions.products.get(productName) ?? 0) + 1);
        }
      }
    }
    function addProducts(
      items: { productName: string; quantity: number; subtotalCents: number }[],
    ) {
      for (const item of items) {
        const current = byProduct.get(item.productName) ?? {
          name: item.productName,
          quantity: 0,
          amountCents: 0,
        };
        current.quantity += item.quantity;
        current.amountCents += item.subtotalCents;
        byProduct.set(item.productName, current);
      }
    }
    for (const payment of payments) {
      totalCents += payment.amountCents;
      byMethod.set(
        payment.method,
        (byMethod.get(payment.method) ?? 0) + payment.amountCents,
      );
      const local = new Date(payment.createdAt.getTime() - 5 * 60 * 60 * 1000);
      const dayKey = local.toISOString().slice(0, 10);
      byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + payment.amountCents);
      const weekKey = reportWeekStart(dayKey);
      byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + payment.amountCents);
      if (payment.session) {
        const target = payment.session;
        sessionRevenueCents += payment.amountCents;
        sessions.set(target.id, target.totalAmount);
        const stationAmount = byStation.get(target.station.name) ?? {
          name: target.station.name,
          amountCents: 0,
        };
        stationAmount.amountCents += payment.amountCents;
        byStation.set(target.station.name, stationAmount);
        const started = new Date(
          target.startedAt.getTime() - 5 * 60 * 60 * 1000,
        );
        byHour.set(
          started.getUTCHours(),
          (byHour.get(started.getUTCHours()) ?? 0) + 1,
        );
        const timeCents =
          target.baseAmount +
          target.extensions.reduce((sum, item) => sum + item.amount, 0);
        const extraCents = target.extras.reduce(
          (sum, item) => sum + item.total,
          0,
        );
        const saleCents = target.sales.reduce(
          (sum, sale) => sum + sale.totalCents,
          0,
        );
        extrasCents += extraCents;
        snacksCents += saleCents;
        if (target.station.type === "PC") pcCents += timeCents;
        else playstationCents += timeCents;
        for (const sale of target.sales) addProducts(sale.items);
      } else if (payment.sale) {
        snacksCents += payment.sale.totalCents;
        addProducts(payment.sale.items);
      }
    }
    const topStation =
      [...byStation.values()].sort(
        (a, b) => b.amountCents - a.amountCents,
      )[0] ?? null;
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      totalCents,
      categories: { pcCents, playstationCents, extrasCents, snacksCents },
      promotions: {
        freeHours: promotions.freeHours,
        snackKits: promotions.snackKits,
        freeHourValueCents: promotions.freeHourValueCents,
        snackKitValueCents: promotions.snackKitValueCents,
        totalValueCents:
          promotions.freeHourValueCents + promotions.snackKitValueCents,
        products: [...promotions.products.entries()].map(([name, quantity]) => ({
          name,
          quantity,
        })),
      },
      paymentsByMethod: [...byMethod.entries()]
        .map(([method, amountCents]) => ({ method, amountCents }))
        .sort((a, b) => b.amountCents - a.amountCents),
      sessions: {
        count: sessions.size,
        averageCents: sessions.size
          ? Math.round(sessionRevenueCents / sessions.size)
          : 0,
      },
      topStation,
      topProducts: [...byProduct.values()]
        .sort((a, b) => b.amountCents - a.amountCents)
        .slice(0, 10),
      demandByHour: [...byHour.entries()]
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour - b.hour),
      totalsByDay: [...byDay.entries()]
        .map(([day, amountCents]) => ({ day, amountCents }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      totalsByWeek: [...byWeek.entries()]
        .map(([weekStart, amountCents]) => ({ weekStart, amountCents }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
      shift,
    };
  }
  function editable(s: SessionDetail) {
    if (
      s.finishedAt ||
      ["PAUSED", "SAVED", "CLOSED", "CANCELLED"].includes(s.status)
    )
      throw new ApiError(409, "La sesión ya fue finalizada");
  }
  function remainingSeconds(s: SessionDetail, now: Date) {
    if (s.mode !== "FIXED" || !s.endsAt)
      throw new ApiError(409, "Solo las sesiones por tiempo pueden pausarse");
    return Math.max(0, Math.ceil((s.endsAt.getTime() - now.getTime()) / 1000));
  }
  async function savedCode(tx: Prisma.TransactionClient) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!(await tx.session.findUnique({ where: { savedCode: code } })))
        return code;
    }
    throw new ApiError(409, "No se pudo generar el código de guardado");
  }
  app.get("/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", serverTime: new Date().toISOString() };
  });
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req) => {
      const input = loginInput.parse(req.body);
      const user = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      // Perform the same password work for unknown users to avoid an obvious timing signal.
      const hash =
        user?.passwordHash ??
        "00000000000000000000000000000000:" + "00".repeat(64);
      const valid = await verifyPassword(input.password, hash);
      if (!user?.active || !valid)
        throw new ApiError(401, "Correo o contraseña incorrectos");
      return {
        token: app.jwt.sign({ sub: user.id }),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    },
  );
  app.get("/auth/me", async (req) => actor(req));
  app.get("/users", async (req) => {
    admin(req);
    return db.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: { name: "asc" },
    });
  });
  app.post("/users", async (req) => {
    admin(req);
    const input = userInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    return mutate(req, async (tx) => {
      const u = await tx.user.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          role: input.role,
          passwordHash,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      await audit(tx, req, "USER_CREATED", "User", u.id, null, u);
      return u;
    });
  });
  app.patch("/users/:id", async (req) => {
    admin(req);
    const id = idOf(req);
    const input = userUpdateInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) throw new ApiError(404, "Trabajador no encontrado");
      const u = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          role: input.role,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      await audit(tx, req, "USER_CHANGED", "User", id, old, u);
      return u;
    });
  });
  app.put("/users/:id/password", async (req) => {
    admin(req);
    const id = idOf(req);
    const input = passwordResetInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    return mutate(req, async (tx) => {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old) throw new ApiError(404, "Trabajador no encontrado");
      const u = await tx.user.update({
        where: { id },
        data: { passwordHash },
        select: { id: true, name: true, email: true, role: true },
      });
      await audit(tx, req, "PASSWORD_RESET", "User", id, null, {
        userId: id,
      });
      return u;
    });
  });
  const loyaltyCardInclude = {
    redemptions: {
      orderBy: { createdAt: "desc" as const },
      take: 20,
      select: {
        id: true,
        rewardType: true,
        stampsUsed: true,
        promotionValueCents: true,
        sodaProductName: true,
        snackProductName: true,
        createdAt: true,
      },
    },
  };
  app.get("/loyalty/cards", async (req) => {
    const query = z
      .object({ search: z.string().trim().max(80).optional() })
      .parse(req.query);
    return db.loyaltyCard.findMany({
      where: {
        active: true,
        ...(query.search
          ? { customerName: { contains: query.search, mode: "insensitive" } }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: loyaltyCardInclude,
    });
  });
  app.post("/loyalty/cards", async (req) => {
    const customerName = z
      .object({ customerName: z.string().trim().min(2).max(80) })
      .parse(req.body).customerName;
    return mutate(req, async (tx) => {
      const card = await tx.loyaltyCard.create({
        data: { customerName },
        include: loyaltyCardInclude,
      });
      await audit(tx, req, "LOYALTY_CARD_CREATED", "LoyaltyCard", card.id, null, card);
      return card;
    });
  });
  app.patch("/loyalty/cards/:id", async (req) => {
    const id = idOf(req),
      input = loyaltyCardUpdateInput.parse(req.body ?? {});
    return mutate(req, async (tx) => {
      const old = await tx.loyaltyCard.findUnique({ where: { id } });
      if (!old?.active)
        throw new ApiError(404, "Tarjeta de fidelización no encontrada");
      const updated = await tx.loyaltyCard.update({
        where: { id },
        data: { customerName: input.customerName },
        include: loyaltyCardInclude,
      });
      await audit(tx, req, "LOYALTY_CARD_UPDATED", "LoyaltyCard", id, old, updated);
      return updated;
    }, events.loyaltyUpdated);
  });
  app.delete("/loyalty/cards/:id", async (req) => {
    const id = idOf(req);
    return mutate(req, async (tx) => {
      const old = await tx.loyaltyCard.findUnique({ where: { id } });
      if (!old?.active)
        throw new ApiError(404, "Tarjeta de fidelización no encontrada");
      const updated = await tx.loyaltyCard.update({
        where: { id },
        data: { active: false },
        include: loyaltyCardInclude,
      });
      await audit(
        tx,
        req,
        "LOYALTY_CARD_DEACTIVATED",
        "LoyaltyCard",
        id,
        old,
        updated,
      );
      return updated;
    }, events.loyaltyUpdated);
  });
  app.post("/loyalty/cards/:id/stamps", async (req) => {
    const id = idOf(req);
    const input = loyaltyStampInput.parse(req.body);
    return mutate(req, async (tx) => {
      const card = await tx.loyaltyCard.findUnique({ where: { id } });
      if (!card?.active) throw new ApiError(404, "Tarjeta de fidelización no encontrada");
      if (card.freeHourAvailable)
        throw new ApiError(409, "Canjea la hora gratis antes de seguir acumulando sellos");
      if (card.snackKitAvailable)
        throw new ApiError(409, "Canjea el kit de snacks antes de reiniciar la tarjeta");
      if (card.stampCount + input.quantity > 12)
        throw new ApiError(409, "La tarjeta solo tiene 12 sellos");
      if (card.stampCount < 6 && card.stampCount + input.quantity > 6)
        throw new ApiError(409, "Completa primero los 6 sellos de la hora gratis");
      const stampCount = card.stampCount + input.quantity;
      const updated = await tx.loyaltyCard.update({
        where: { id },
        data: {
          stampCount,
          freeHourAvailable: stampCount === 6,
          snackKitAvailable: stampCount === 12,
        },
        include: loyaltyCardInclude,
      });
      await audit(tx, req, "LOYALTY_STAMP_ADDED", "LoyaltyCard", id, card, updated);
      return updated;
    }, events.loyaltyUpdated);
  });
  app.post("/loyalty/cards/:id/redeem", async (req) => {
    const id = idOf(req);
    const input = loyaltyRedeemInput.parse(req.body);
    return mutate(req, async (tx) => {
      const card = await tx.loyaltyCard.findUnique({ where: { id } });
      if (!card?.active) throw new ApiError(404, "Tarjeta de fidelización no encontrada");
      if (input.rewardType === "FREE_HOUR") {
        if (card.stampCount !== 6 || !card.freeHourAvailable)
          throw new ApiError(409, "La hora gratis se habilita al completar 6 sellos");
        if (!input.stationId)
          throw new ApiError(400, "Selecciona una estación libre para la hora gratis");
        const station = await tx.station.findUnique({
          where: { id: input.stationId },
          include: { rates: { orderBy: { createdAt: "desc" }, take: 1 } },
        });
        if (!station?.active) throw new ApiError(404, "Estación no encontrada");
        if (
          station.status !== "AVAILABLE" ||
          (await tx.session.findFirst({
            where: {
              stationId: station.id,
              status: { notIn: ["CLOSED", "CANCELLED", "PAUSED", "SAVED"] },
            },
          }))
        )
          throw new ApiError(409, "La estación seleccionada ya no está disponible");
        const hourlyCents = station.rates[0]?.hourlyCents;
        if (!hourlyCents) throw new ApiError(409, "Configura una tarifa para la estación");
        const now = new Date();
        const freeSession = await tx.session.create({
          data: {
            stationId: station.id,
            startedBy: actor(req).id,
            startedAt: now,
            mode: "FIXED",
            baseMinutes: 60,
            baseAmount: 0,
            hourlyCents,
            totalAmount: 0,
            endsAt: new Date(now.getTime() + 60 * 60 * 1000),
          },
        });
        await tx.station.update({ where: { id: station.id }, data: { status: "IN_USE" } });
        const redemption = await tx.loyaltyRedemption.create({
          data: {
            cardId: id,
            rewardType: "FREE_HOUR",
            stampsUsed: 6,
            promotionValueCents: hourlyCents,
            createdBy: actor(req).id,
          },
        });
        const updated = await tx.loyaltyCard.update({
          where: { id },
          data: { freeHourAvailable: false },
          include: loyaltyCardInclude,
        });
        await audit(tx, req, "SESSION_STARTED", "Session", freeSession.id, null, { ...freeSession, loyaltyCardId: id });
        await audit(tx, req, "LOYALTY_FREE_HOUR_REDEEMED", "LoyaltyCard", id, card, { updated, redemption, freeSessionId: freeSession.id });
        return { ...updated, freeSessionId: freeSession.id };
      }
      if (card.stampCount !== 12 || !card.snackKitAvailable)
        throw new ApiError(409, "El kit de snacks se habilita al completar 12 sellos");
      if (!input.sodaProductId || !input.snackProductId)
        throw new ApiError(400, "Selecciona una bebida y un snack para el kit");
      if (input.sodaProductId === input.snackProductId)
        throw new ApiError(400, "La bebida y el snack deben ser productos distintos");
      const kitProducts = await tx.product.findMany({
        where: {
          id: { in: [input.sodaProductId, input.snackProductId] },
          active: true,
        },
      });
      const soda = kitProducts.find((product) => product.id === input.sodaProductId);
      const snack = kitProducts.find((product) => product.id === input.snackProductId);
      if (!soda || !snack) throw new ApiError(404, "Uno de los productos del kit no está disponible");
      if (soda.category !== "BEVERAGE")
        throw new ApiError(400, `${soda.name} no está clasificado como bebida`);
      if (snack.category !== "SNACK")
        throw new ApiError(400, `${snack.name} no está clasificado como snack`);
      if (soda.stockCurrent < 1) throw new ApiError(409, `Stock insuficiente para ${soda.name}`);
      if (snack.stockCurrent < 1) throw new ApiError(409, `Stock insuficiente para ${snack.name}`);
      for (const product of [soda, snack]) {
        await tx.product.update({
          where: { id: product.id },
          data: { stockCurrent: { decrement: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            type: "SALE",
            quantity: -1,
            stockBefore: product.stockCurrent,
            stockAfter: product.stockCurrent - 1,
            reason: `Canje de kit de fidelización · ${card.customerName}`,
            createdBy: actor(req).id,
          },
        });
      }
      const redemption = await tx.loyaltyRedemption.create({
        data: {
          cardId: id,
          rewardType: "SNACK_KIT",
          stampsUsed: 6,
          promotionValueCents:
            (soda.costCents ?? soda.salePriceCents) +
            (snack.costCents ?? snack.salePriceCents),
          sodaProductName: soda.name,
          snackProductName: snack.name,
          createdBy: actor(req).id,
        },
      });
      const updated = await tx.loyaltyCard.update({
        where: { id },
        data: { stampCount: 0, snackKitAvailable: false },
        include: loyaltyCardInclude,
      });
      await audit(tx, req, "LOYALTY_SNACK_KIT_REDEEMED", "LoyaltyCard", id, card, { updated, redemption });
      return { ...updated, kit: { soda: soda.name, snack: snack.name } };
    }, [events.loyaltyUpdated, events.inventoryUpdated]);
  });
  app.get("/stations", async () => {
    const now = new Date();
    const stations = await db.station.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        rates: { orderBy: { createdAt: "desc" }, take: 1 },
        sessions: {
          where: {
            status: { notIn: ["CLOSED", "CANCELLED", "SAVED"] },
          },
          include: details,
        },
      },
    });
    return {
      serverTime: now.toISOString(),
      stations: stations.map((s) => {
        const current = s.sessions[0] ? view(s.sessions[0], now) : null;
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          hourlyCents: s.rates[0]?.hourlyCents ?? 0,
          session: current,
          status: current
            ? current.status === "TIME_FINISHED"
              ? "FINISHED"
              : current.status === "PAUSED"
                ? "PAUSED"
                : "IN_USE"
            : s.status,
        };
      }),
    };
  });
  app.post("/stations", async (req) => {
    admin(req);
    const data = stationInput.parse(req.body);
    return mutate(req, async (tx) => {
      const s = await tx.station.create({
        data: {
          name: data.name,
          type: data.type,
          rates: { create: { hourlyCents: data.hourlyCents } },
        },
      });
      await audit(tx, req, "STATION_CREATED", "Station", s.id, null, s);
      return s;
    });
  });
  app.delete("/stations/:id", async (req) => {
    admin(req);
    const id = idOf(req);
    return mutate(req, async (tx) => {
      const station = await tx.station.findUnique({
        where: { id },
        include: {
          sessions: {
            where: { status: { notIn: ["CLOSED", "CANCELLED"] } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!station) throw new ApiError(404, "Estación no encontrada");
      if (station.sessions.length)
        throw new ApiError(409, "No puedes eliminar una estación en uso");
      const updated = await tx.station.update({
        where: { id },
        data: { active: false, status: "OFFLINE" },
      });
      await audit(
        tx,
        req,
        "STATION_DEACTIVATED",
        "Station",
        id,
        station,
        updated,
      );
      return updated;
    });
  });
  app.post("/stations/:id/rates", async (req) => {
    admin(req);
    const id = idOf(req),
      data = rateInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await tx.stationRate.findFirst({
        where: { stationId: id },
        orderBy: { createdAt: "desc" },
      });
      if (!old) throw new ApiError(404, "Estación no encontrada");
      const rate = await tx.stationRate.create({
        data: { stationId: id, ...data },
      });
      await audit(tx, req, "RATE_CHANGED", "Station", id, old, rate);
      return rate;
    });
  });
  app.get("/extras", async () =>
    db.extra.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  );
  app.get("/settings", async (req) => {
    admin(req);
    const rows = await db.setting.findMany({
      where: {
        key: {
          in: [
            "ALERT_FIRST_MINUTES",
            "ALERT_SECOND_MINUTES",
            "NOTIFICATION_SOUND",
          ],
        },
      },
    });
    return {
      ALERT_FIRST_MINUTES:
        Number(rows.find((row) => row.key === "ALERT_FIRST_MINUTES")?.value) ||
        10,
      ALERT_SECOND_MINUTES:
        Number(rows.find((row) => row.key === "ALERT_SECOND_MINUTES")?.value) ||
        5,
      NOTIFICATION_SOUND:
        rows.find((row) => row.key === "NOTIFICATION_SOUND")?.value ??
        notificationSoundValues[0],
    };
  });
  app.get("/settings/notification-sound", async (req) => {
    actor(req);
    const row = await db.setting.findUnique({
      where: { key: "NOTIFICATION_SOUND" },
    });
    const sound = row?.value ?? notificationSoundValues[0];
    return {
      sound: notificationSoundValues.includes(
        sound as (typeof notificationSoundValues)[number],
      )
        ? sound
        : notificationSoundValues[0],
    };
  });
  app.put("/settings", async (req) => {
    admin(req);
    const raw = req.body as Record<string, unknown>;
    const input =
      raw?.key === "NOTIFICATION_SOUND"
        ? {
            key: "NOTIFICATION_SOUND" as const,
            value: z
              .string()
              .refine(
                (value): value is (typeof notificationSoundValues)[number] =>
                  notificationSoundValues.includes(
                    value as (typeof notificationSoundValues)[number],
                  ),
                "Sonido no disponible",
              )
              .parse(raw.value),
          }
        : settingInput.parse(raw);
    return mutate(req, async (tx) => {
      const old = await tx.setting.findUnique({ where: { key: input.key } });
      const setting = await tx.setting.upsert({
        where: { key: input.key },
        update: { value: String(input.value), updatedBy: actor(req).id },
        create: {
          key: input.key,
          value: String(input.value),
          updatedBy: actor(req).id,
        },
      });
      await audit(
        tx,
        req,
        "SETTING_CHANGED",
        "Setting",
        input.key,
        old,
        setting,
      );
      return {
        key: setting.key,
        value:
          input.key === "NOTIFICATION_SOUND"
            ? setting.value
            : Number(setting.value),
      };
    });
  });
  app.post("/extras", async (req) => {
    admin(req);
    const data = extraInput.parse(req.body);
    return mutate(req, async (tx) => {
      const e = await tx.extra.create({ data });
      await audit(tx, req, "EXTRA_CREATED", "Extra", e.id, null, e);
      return e;
    });
  });
  app.patch("/extras/:id", async (req) => {
    admin(req);
    const id = idOf(req),
      data = extraInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await tx.extra.findUniqueOrThrow({ where: { id } });
      const e = await tx.extra.update({ where: { id }, data });
      await audit(tx, req, "EXTRA_CHANGED", "Extra", id, old, e);
      return e;
    });
  });
  app.get("/products", async () =>
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  );
  app.post("/products", async (req) => {
    admin(req);
    const data = productInput.parse(req.body);
    return mutate(req, async (tx) => {
      const existing = await tx.product.findUnique({
        where: { name: data.name },
      });
      if (existing?.active)
        throw new ApiError(409, "Ya existe un producto con ese nombre");
      if (existing) {
        const product = await tx.product.update({
          where: { id: existing.id },
          data: { ...data, active: true },
        });
        await audit(
          tx,
          req,
          "PRODUCT_REACTIVATED",
          "Product",
          product.id,
          existing,
          product,
        );
        return product;
      }
      const product = await tx.product.create({ data });
      await audit(
        tx,
        req,
        "PRODUCT_CREATED",
        "Product",
        product.id,
        null,
        product,
      );
      return product;
    });
  });
  app.patch("/products/:id", async (req) => {
    admin(req);
    const id = idOf(req),
      data = productInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await tx.product.findUniqueOrThrow({ where: { id } });
      const product = await tx.product.update({ where: { id }, data });
      await audit(tx, req, "PRODUCT_CHANGED", "Product", id, old, product);
      return product;
    });
  });
  app.delete("/products/:id", async (req) => {
    admin(req);
    const id = idOf(req);
    return mutate(req, async (tx) => {
      const old = await tx.product.findUnique({ where: { id } });
      if (!old) throw new ApiError(404, "Producto no encontrado");
      const product = await tx.product.update({
        where: { id },
        data: { active: false },
      });
      await audit(tx, req, "PRODUCT_DEACTIVATED", "Product", id, old, product);
      return product;
    });
  });
  app.post("/products/:id/stock", async (req) => {
    admin(req);
    const id = idOf(req),
      data = stockInput.parse(req.body);
    return mutate(req, async (tx) => {
      const product = await tx.product.findUnique({ where: { id } });
      if (!product?.active) throw new ApiError(404, "Producto no disponible");
      const signed =
        data.type === "PURCHASE" || data.type === "RETURN"
          ? data.quantity
          : -data.quantity;
      const next = product.stockCurrent + signed;
      if (next < 0)
        throw new ApiError(409, "El movimiento dejaría stock negativo");
      const updated = await tx.product.update({
        where: { id },
        data: {
          stockCurrent: next,
          ...(data.type === "PURCHASE" && data.unitCostCents !== undefined
            ? { costCents: data.unitCostCents }
            : {}),
        },
      });
      const movement = await tx.inventoryMovement.create({
        data: {
          productId: id,
          type: data.type,
          quantity: signed,
          stockBefore: product.stockCurrent,
          stockAfter: next,
          unitCostCents: data.unitCostCents,
          reason: data.reason,
          createdBy: actor(req).id,
        },
      });
      await audit(tx, req, "STOCK_MOVEMENT_CREATED", "Product", id, product, {
        product: updated,
        movement,
      });
      return updated;
    });
  });
  app.get("/inventory", async () =>
    db.inventoryMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { product: { select: { name: true } } },
    }),
  );
  app.post("/sales", async (req) => {
    const data = saleInput.parse(req.body);
    return mutate(req, (tx) => createSale(tx, req, data));
  });
  app.get("/sessions", async (req) => {
    const query = z
      .object({
        stationId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    return db.session
      .findMany({
        where: { stationId: query.stationId },
        orderBy: { startedAt: "desc" },
        take: query.limit,
        include: {
          ...details,
          station: { select: { name: true, type: true } },
        },
      })
      .then((rows) => rows.map((s) => view(s, new Date())));
  });
  app.get("/sessions/:id", async (req) =>
    view(await session(db, idOf(req)), new Date()),
  );
  app.post("/sessions", async (req) => {
    const input = startInput.parse(req.body);
    return mutate(req, async (tx) => {
      const s = await tx.station.findUnique({
        where: { id: input.stationId },
        include: { rates: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!s?.active) throw new ApiError(404, "Estación no encontrada");
      if (input.extraId && s.type === "PC")
        throw new ApiError(
          400,
          "Los mandos solo están disponibles en consolas",
        );
      if (
        s.status !== "AVAILABLE" ||
        (await tx.session.findFirst({
          where: {
            stationId: s.id,
            status: { notIn: ["CLOSED", "CANCELLED", "PAUSED", "SAVED"] },
          },
        }))
      )
        throw new ApiError(409, "La estación no está disponible");
      const hourlyCents = s.rates[0]?.hourlyCents;
      if (!hourlyCents) throw new ApiError(409, "Configura una tarifa");
      const now = new Date(),
        minutes = input.mode === "FIXED" ? input.minutes! : null;
      const baseAmount = minutes
        ? priceForBlocks(hourlyCents, s.type, minutes)
        : 0;
      const created = await tx.session.create({
        data: {
          stationId: s.id,
          startedBy: actor(req).id,
          startedAt: now,
          mode: input.mode,
          baseMinutes: minutes,
          baseAmount,
          hourlyCents,
          totalAmount: baseAmount,
          endsAt: minutes ? new Date(now.getTime() + minutes * 60000) : null,
        },
      });
      if (input.extraId)
        await addExtra(tx, created.id, input.extraId, input.extraQuantity);
      const result = await session(tx, created.id);
      const totalAmount = sessionTotal(
        baseAmount,
        result.extensions,
        result.extras,
      );
      await tx.session.update({
        where: { id: created.id },
        data: { totalAmount },
      });
      await tx.station.update({
        where: { id: s.id },
        data: { status: "IN_USE" },
      });
      await audit(tx, req, "SESSION_STARTED", "Session", created.id, null, {
        ...result,
        totalAmount,
      });
      return view({ ...result, totalAmount }, now);
    });
  });
  app.post("/sessions/:id/extend", async (req) => {
    const id = idOf(req),
      input = extendInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await session(tx, id);
      editable(old);
      if (old.payments.length)
        throw new ApiError(
          409,
          "La sesión ya fue pagada; no admite más tiempo",
        );
      if (old.mode === "OPEN" || !old.endsAt)
        throw new ApiError(409, "Las sesiones libres no necesitan extensiones");
      const amount = priceForBlocks(
        old.hourlyCents,
        old.station.type,
        input.minutes,
      );
      await tx.sessionExtension.create({
        data: {
          sessionId: id,
          minutesAdded: input.minutes,
          amount,
          createdBy: actor(req).id,
        },
      });
      const updated = await tx.session.update({
        where: { id },
        data: {
          endsAt: new Date(old.endsAt.getTime() + input.minutes * 60000),
          totalAmount: { increment: amount },
          status: "ACTIVE",
        },
        include: details,
      });
      await audit(tx, req, "SESSION_EXTENDED", "Session", id, old, updated);
      return view(updated, new Date());
    });
  });
  app.post("/sessions/:id/extras", async (req) => {
    const id = idOf(req),
      input = addExtraInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await session(tx, id);
      editable(old);
      if (old.payments.length)
        throw new ApiError(
          409,
          "La sesión ya fue pagada; no admite nuevos extras",
        );
      const station = await tx.station.findUnique({
        where: { id: old.stationId },
        select: { type: true },
      });
      if (station?.type === "PC")
        throw new ApiError(
          400,
          "Los mandos solo están disponibles en consolas",
        );
      const extra = await addExtra(tx, id, input.extraId, input.quantity);
      const updated = await tx.session.update({
        where: { id },
        data: { totalAmount: { increment: extra.addedTotal } },
        include: details,
      });
      await audit(tx, req, "SESSION_EXTRA_ADDED", "Session", id, old, updated);
      return view(updated, new Date());
    });
  });
  app.post("/sessions/:id/products", async (req) => {
    const sessionId = idOf(req);
    const data = saleInput.omit({ sessionId: true }).parse(req.body);
    return mutate(req, (tx) => createSale(tx, req, { ...data, sessionId }));
  });
  app.post("/sessions/:id/move", async (req) => {
    const id = idOf(req),
      input = sessionMoveInput.parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        editable(old);
        const current = view(old, new Date());
        if (!["ACTIVE", "ENDING_SOON"].includes(current.status))
          throw new ApiError(409, "Solo se puede mover una sesión activa");
        if (old.stationId === input.stationId)
          throw new ApiError(409, "La sesión ya está en esa estación");
        const target = await tx.station.findUnique({
          where: { id: input.stationId },
          select: { id: true, name: true, type: true, active: true, status: true },
        });
        if (!target?.active)
          throw new ApiError(404, "Estación de destino no encontrada");
        if (target.type !== old.station.type)
          throw new ApiError(409, "Solo puedes mover la sesión a una estación del mismo tipo");
        if (
          target.status !== "AVAILABLE" ||
          (await tx.session.findFirst({
            where: {
              stationId: target.id,
              status: { notIn: ["CLOSED", "CANCELLED", "PAUSED", "SAVED"] },
            },
            select: { id: true },
          }))
        )
          throw new ApiError(409, "La estación de destino no está disponible");
        const updated = await tx.session.update({
          where: { id },
          data: { stationId: target.id },
          include: details,
        });
        await tx.station.update({
          where: { id: old.stationId },
          data: { status: "AVAILABLE" },
        });
        await tx.station.update({
          where: { id: target.id },
          data: { status: "IN_USE" },
        });
        await audit(tx, req, "SESSION_MOVED", "Session", id, old, {
          ...updated,
          fromStationId: old.stationId,
          toStationId: target.id,
          toStationName: target.name,
        });
        return view(updated, new Date());
      },
      [events.sessionUpdated, events.stationUpdated],
    );
  });
  app.post("/sessions/:id/finish", async (req) => {
    const id = idOf(req);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return mutate(req, async (tx) => {
      const old = await session(tx, id);
      editable(old);
      const now = new Date();
      const computed = view(old, now);
      const closesFreeHour = !old.payments.length && computed.totalAmount === 0;
      const updated = await tx.session.update({
        where: { id },
        data: {
          status: old.payments.length || closesFreeHour ? "CLOSED" : "TIME_FINISHED",
          finishedAt: now,
          baseAmount: computed.baseAmount,
          totalAmount: computed.totalAmount,
          ...(old.payments.length || closesFreeHour
            ? { closedAt: now, closedBy: actor(req).id }
            : {}),
        },
        include: details,
      });
      await tx.station.update({
        where: { id: old.stationId },
        data: { status: old.payments.length || closesFreeHour ? "AVAILABLE" : "FINISHED" },
      });
      await audit(
        tx,
        req,
        old.payments.length
          ? "SESSION_FINISHED_PREPAID"
          : closesFreeHour
            ? "SESSION_FINISHED_FREE_HOUR"
          : "SESSION_FINISHED_PENDING_PAYMENT",
        "Session",
        id,
        old,
        updated,
      );
      return view(updated, now);
    });
  });
  app.post("/sessions/:id/pause", async (req) => {
    const id = idOf(req);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        editable(old);
        const now = new Date();
        const seconds = old.mode === "FIXED" ? remainingSeconds(old, now) : null;
        if (old.mode === "FIXED" && !seconds)
          throw new ApiError(409, "La sesión ya terminó");
        const updated = await tx.session.update({
          where: { id },
          data: {
            status: "PAUSED",
            pausedAt: now,
            pausedRemainingSeconds: seconds,
            endsAt:
              old.mode === "FIXED"
                ? new Date(now.getTime() + seconds! * 1000)
                : null,
          },
          include: details,
        });
        await tx.station.update({
          where: { id: old.stationId },
          data: { status: "IN_USE" },
        });
        await audit(tx, req, "SESSION_PAUSED", "Session", id, old, updated);
        return view(updated, now);
      },
      events.sessionUpdated,
    );
  });
  app.post("/sessions/:id/cancel", async (req) => {
    const id = idOf(req),
      input = sessionCancelInput.parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        if (["CLOSED", "CANCELLED"].includes(old.status))
          throw new ApiError(409, "La sesión ya fue cerrada");
        if (old.payments.length)
          throw new ApiError(409, "Una sesión pagada debe conservarse");
        const updated = await tx.session.update({
          where: { id },
          data: {
            status: "CANCELLED",
            finishedAt: new Date(),
            cancelReason: input.reason,
          },
          include: details,
        });
        await tx.station.update({
          where: { id: old.stationId },
          data: { status: "AVAILABLE" },
        });
        await audit(tx, req, "SESSION_CANCELLED", "Session", id, old, updated);
        return view(updated, new Date());
      },
      events.sessionUpdated,
    );
  });
  app.post("/sessions/:id/prepay", async (req) => {
    const id = idOf(req),
      { method } = paymentInput.parse(req.body);
    return mutate(
      req,
      async (tx) => {
        const register = await openCash(tx);
        const old = await session(tx, id);
        editable(old);
        if (old.mode !== "FIXED")
          throw new ApiError(
            409,
            "El pago anticipado requiere una duración fija",
          );
        if (old.payments.length)
          throw new ApiError(409, "La sesión ya tiene un pago registrado");
        const now = new Date();
        const current = view(old, now);
        if (current.status === "TIME_FINISHED")
          throw new ApiError(
            409,
            "La sesión ya terminó; registra el pago final",
          );
        const payment = await tx.payment.create({
          data: {
            sessionId: id,
            cashRegisterId: register.id,
            method,
            amountCents: current.totalAmount,
            createdBy: actor(req).id,
          },
        });
        await tx.session.update({
          where: { id },
          data: { totalAmount: current.totalAmount },
        });
        await tx.sale.updateMany({
          where: { sessionId: id, status: "OPEN" },
          data: { status: "PAID" },
        });
        await tx.cashMovement.create({
          data: {
            cashRegisterId: register.id,
            type: "PAYMENT",
            method,
            amount: current.totalAmount,
            paymentId: payment.id,
            createdBy: actor(req).id,
          },
        });
        await audit(tx, req, "SESSION_PREPAID", "Session", id, old, {
          payment,
          amountCents: current.totalAmount,
        });
        return payment;
      },
      events.sessionUpdated,
    );
  });
  app.post("/sessions/:id/save", async (req) => {
    const id = idOf(req),
      input = sessionSaveInput.parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        editable(old);
        if (old.mode !== "FIXED" || !old.payments.length)
          throw new ApiError(
            409,
            "Solo puedes guardar una sesión fija ya pagada",
          );
        const now = new Date();
        const seconds = remainingSeconds(old, now);
        if (!seconds) throw new ApiError(409, "La sesión ya terminó");
        const code = await savedCode(tx);
        const updated = await tx.session.update({
          where: { id },
          data: {
            status: "SAVED",
            savedCode: code,
            savedAt: now,
            savedName: input.name ?? null,
            savedRemainingSeconds: seconds,
            endsAt: new Date(now.getTime() + seconds * 1000),
          },
          include: details,
        });
        await tx.station.update({
          where: { id: old.stationId },
          data: { status: "AVAILABLE" },
        });
        await audit(tx, req, "SESSION_SAVED", "Session", id, old, updated);
        return view(updated, now);
      },
      events.sessionUpdated,
    );
  });
  app.post("/sessions/:id/resume", async (req) => {
    const id = idOf(req),
      input = sessionResumeInput.parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        if (!["PAUSED", "SAVED"].includes(old.status))
          throw new ApiError(409, "La sesión no está guardada ni pausada");
        if (old.status === "SAVED" && !old.payments.length)
          throw new ApiError(
            409,
            "La sesión guardada no tiene un pago confirmado",
          );
        const isOpen = old.mode === "OPEN";
        const seconds = isOpen
          ? null
          : old.status === "SAVED"
            ? old.savedRemainingSeconds
            : old.pausedRemainingSeconds;
        if (!isOpen && (!seconds || seconds <= 0))
          throw new ApiError(409, "La sesión ya no tiene tiempo restante");
        if (isOpen && (!old.pausedAt || old.pausedAt <= old.startedAt))
          throw new ApiError(409, "La sesión libre no tiene una pausa válida");
        const original = await tx.station.findUnique({
          where: { id: old.stationId },
          select: { id: true, type: true, active: true, status: true },
        });
        if (!original?.active)
          throw new ApiError(409, "La estación original no está disponible");
        const target = input.stationId
          ? await tx.station.findUnique({
              where: { id: input.stationId },
              select: { id: true, type: true, active: true, status: true },
            })
          : original.status === "AVAILABLE" ||
              (old.status === "PAUSED" && original.status === "IN_USE")
            ? original
            : await tx.station.findFirst({
                where: {
                  active: true,
                  type: original.type,
                  status: "AVAILABLE",
                  id: { not: old.stationId },
                },
                orderBy: { name: "asc" },
                select: { id: true, type: true, active: true, status: true },
              });
        if (
          !target ||
          !target.active ||
          target.type !== original.type ||
          (target.status !== "AVAILABLE" &&
            !(
              old.status === "PAUSED" &&
              target.id === old.stationId &&
              target.status === "IN_USE"
            ))
        )
          throw new ApiError(
            409,
            "No hay una estación disponible del mismo tipo",
          );
        const now = new Date();
        const updated = await tx.session.update({
          where: { id },
          data: {
            stationId: target.id,
            startedAt: isOpen
              ? new Date(
                  old.startedAt.getTime() +
                    (now.getTime() - old.pausedAt!.getTime()),
                )
              : now,
            endsAt: isOpen ? null : new Date(now.getTime() + seconds! * 1000),
            status: "ACTIVE",
            finishedAt: null,
            pausedAt: null,
            pausedRemainingSeconds: null,
            savedAt: null,
            savedCode: null,
            savedName: null,
            savedRemainingSeconds: null,
          },
          include: details,
        });
        if (target.id !== old.stationId)
          await tx.station.update({
            where: { id: old.stationId },
            data: { status: "AVAILABLE" },
          });
        await tx.station.update({
          where: { id: target.id },
          data: { status: "IN_USE" },
        });
        await audit(tx, req, "SESSION_RESUMED", "Session", id, old, updated);
        return view(updated, now);
      },
      events.sessionUpdated,
    );
  });
  app.get("/sessions/saved", async () =>
    db.session
      .findMany({
        where: { status: "SAVED" },
        orderBy: { savedAt: "desc" },
        include: details,
      })
      .then((rows) => rows.map((s) => view(s, new Date()))),
  );
  app.get("/cash/current", async () => {
    const register = await db.cashRegister.findFirst({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
      include: {
        movements: { orderBy: { createdAt: "desc" }, take: 100 },
        payments: true,
      },
    });
    if (!register) return { register: null };
    const expectedAmount =
      register.openingAmount +
      register.movements
        .filter((m) => m.method === "CASH" && m.type !== "OPENING")
        .reduce(
          (sum, m) => sum + (m.type === "WITHDRAWAL" ? -m.amount : m.amount),
          0,
        );
    return { register: { ...register, expectedAmount } };
  });
  app.post("/cash/open", async (req) => {
    const data = cashOpenInput.parse(req.body);
    return mutate(req, async (tx) => {
      if (await tx.cashRegister.findFirst({ where: { status: "OPEN" } }))
        throw new ApiError(409, "Ya existe una caja abierta");
      const register = await tx.cashRegister.create({
        data: { openingAmount: data.openingAmount, openedBy: actor(req).id },
      });
      await tx.cashMovement.create({
        data: {
          cashRegisterId: register.id,
          type: "OPENING",
          amount: data.openingAmount,
          method: "CASH",
          createdBy: actor(req).id,
          reason: "Apertura de caja",
        },
      });
      await audit(
        tx,
        req,
        "CASH_OPENED",
        "CashRegister",
        register.id,
        null,
        register,
      );
      return register;
    });
  });
  app.post("/cash/movements", async (req) => {
    const data = cashMovementInput.parse(req.body);
    return mutate(req, async (tx) => {
      const register = await openCash(tx);
      const amount = data.type === "WITHDRAWAL" ? -data.amount : data.amount;
      const movement = await tx.cashMovement.create({
        data: {
          cashRegisterId: register.id,
          type: data.type,
          amount: data.amount,
          method: "CASH",
          reason: data.reason,
          createdBy: actor(req).id,
        },
      });
      await audit(
        tx,
        req,
        "CASH_MOVEMENT_CREATED",
        "CashRegister",
        register.id,
        null,
        movement,
      );
      return { ...movement, signedAmount: amount };
    });
  });
  app.post("/cash/close", async (req) => {
    const data = cashCloseInput.parse(req.body);
    return mutate(req, async (tx) => {
      const register = await openCash(tx);
      const expectedAmount = await cashExpected(tx, register.id);
      const closed = await tx.cashRegister.update({
        where: { id: register.id },
        data: {
          status: "CLOSED",
          closingAmount: data.closingAmount,
          expectedAmount,
          difference: data.closingAmount - expectedAmount,
          closedBy: actor(req).id,
          closedAt: new Date(),
        },
      });
      await audit(
        tx,
        req,
        "CASH_CLOSED",
        "CashRegister",
        register.id,
        register,
        closed,
      );
      return closed;
    });
  });
  app.post("/sessions/:id/pay", async (req) => {
    const id = idOf(req),
      { method } = paymentInput.parse(req.body);
    return mutate(req, (tx) => takePayment(tx, req, { sessionId: id }, method));
  });
  app.post("/sales/:id/pay", async (req) => {
    const id = idOf(req),
      { method } = paymentInput.parse(req.body);
    return mutate(req, (tx) => takePayment(tx, req, { saleId: id }, method));
  });
  app.get("/reports/:period", async (req) => {
    admin(req);
    const period = z
      .enum(["daily", "weekly", "monthly"])
      .parse((req.params as { period: string }).period);
    const query = z
      .object({
        date: z.string().optional(),
        shift: z.enum(["all", "morning", "afternoon"]).default("all"),
      })
      .parse(req.query);
    return report(period, query.date, query.shift);
  });
  app.get("/audit", async (req) => {
    admin(req);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        action: z.string().trim().min(1).max(80).optional(),
        entityType: z.string().trim().min(1).max(40).optional(),
        userId: z.string().uuid().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    const rows = await db.auditLog.findMany({
      where: {
        action: query.action
          ? { contains: query.action, mode: "insensitive" }
          : undefined,
        entityType: query.entityType,
        userId: query.userId,
        createdAt:
          query.from || query.to
            ? { gte: query.from, lt: query.to }
            : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
      select: { id: true, name: true, email: true, role: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => ({ ...row, user: byId.get(row.userId) ?? null }));
  });
  return app;
}
