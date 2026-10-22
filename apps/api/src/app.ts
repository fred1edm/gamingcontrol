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
  adjustExtensionInput,
  addExtraInput,
  productInput,
  stockInput,
  saleInput,
  paymentInput,
  splitPaymentInput,
  cashOpenInput,
  cashCloseInput,
  cashMovementInput,
  settingInput,
  sessionSaveInput,
  sessionResumeInput,
  sessionMoveInput,
  sessionCancelInput,
  sessionRoundInput,
  sessionFinishInput,
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
  extensions: {
    orderBy: { createdAt: "asc" as const },
    include: { adjustments: { orderBy: { createdAt: "asc" as const } } },
  },
  extras: { orderBy: { createdAt: "asc" as const } },
  sales: { include: { items: { orderBy: { createdAt: "asc" as const } } } },
  payments: {
    select: { id: true, method: true, amountCents: true, createdAt: true },
  },
  rateSegments: { orderBy: { startedAt: "asc" as const } },
  station: { select: { name: true, type: true } },
};
type SessionDetail = Prisma.SessionGetPayload<{ include: typeof details }>;
function paidAmount(s: { payments: { amountCents: number }[] }) {
  return s.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}
function segmentMinutes(startedAt: Date, endedAt: Date) {
  return Math.max(1, Math.ceil((endedAt.getTime() - startedAt.getTime()) / 60000));
}
function usedFixedMinutes(
  session: SessionDetail,
  now: Date,
) {
  const segments = session.rateSegments.length
    ? session.rateSegments
    : [{ startedAt: session.startedAt, endedAt: null }];
  const elapsedMs = segments.reduce((sum, segment) => {
    const end = segment.endedAt ?? now;
    return sum + Math.max(0, end.getTime() - segment.startedAt.getTime());
  }, 0);
  return Math.max(1, Math.ceil(elapsedMs / 60000));
}
function usedFixedAmount(session: SessionDetail, now: Date) {
  const segments = session.rateSegments.length
    ? session.rateSegments
    : [{
        stationType: session.station.type,
        hourlyCents: session.hourlyCents,
        startedAt: session.startedAt,
        endedAt: null,
      }];
  return segments.reduce((sum, segment) => {
    const end = segment.endedAt ?? now;
    if (end <= segment.startedAt) return sum;
    return sum + priceForBlocks(
      segment.hourlyCents,
      segment.stationType,
      segmentMinutes(segment.startedAt, end),
    );
  }, 0);
}
function fixedSegmentsAmount(
  session: SessionDetail,
  segments: {
    stationType: SessionDetail["rateSegments"][number]["stationType"];
    hourlyCents: number;
    startedAt: Date;
    endedAt: Date | null;
  }[],
  plannedEnd: Date,
) {
  const totalBlocks = Math.max(1, Math.ceil((session.baseMinutes ?? 0) / 15));
  let remainingBlocks = totalBlocks;
  return segments.reduce((sum, segment, index) => {
    const segmentEnd = segment.endedAt ?? plannedEnd;
    const segmentStart = index === 0 ? session.startedAt : segment.startedAt;
    if (segmentEnd <= segmentStart || remainingBlocks <= 0) return sum;
    const blocks =
      index === segments.length - 1
        ? remainingBlocks
        : Math.min(
            remainingBlocks,
            Math.max(1, Math.ceil(segmentMinutes(segmentStart, segmentEnd) / 15)),
          );
    remainingBlocks -= blocks;
    return sum + priceForBlocks(segment.hourlyCents, segment.stationType, blocks * 15);
  }, 0);
}
function view(s: SessionDetail, now: Date) {
  const openMeasuredAt =
    s.mode === "OPEN" && s.status === "PAUSED" && s.pausedAt
      ? s.pausedAt
      : s.finishedAt ?? now;
  const segments = s.rateSegments.length
    ? s.rateSegments
    : [{
        stationType: s.station.type,
        hourlyCents: s.hourlyCents,
        startedAt: s.startedAt,
        endedAt: null,
      }];
  const freeHour =
    s.mode === "FIXED" && s.baseMinutes === 60 && s.baseAmount === 0;
  const extensions = s.extensions.map((extension) => {
    const adjustment = extension.adjustments.at(-1);
    const rateAtCreation = [...s.rateSegments]
      .reverse()
      .find(
        (segment) =>
          segment.startedAt <= extension.createdAt &&
          (!segment.endedAt || segment.endedAt >= extension.createdAt),
      );
    const snapshotHourlyCents =
      extension.hourlyCents ?? rateAtCreation?.hourlyCents ?? null;
    const snapshotStationType =
      extension.stationType ?? rateAtCreation?.stationType ?? null;
    return {
      ...extension,
      minutesAdded: adjustment?.minutesRemaining ?? extension.minutesAdded,
      amount: adjustment?.amountRemaining ?? extension.amount,
      canAdjust:
        snapshotHourlyCents !== null &&
        snapshotStationType !== null &&
        (Boolean(adjustment) ||
          priceForBlocks(
            snapshotHourlyCents,
            snapshotStationType,
            extension.minutesAdded,
          ) === extension.amount),
    };
  });
  const extensionMinutes = extensions.reduce(
    (sum, extension) => sum + extension.minutesAdded,
    0,
  );
  const fixedPlannedEnd = s.endsAt
    ? new Date(s.endsAt.getTime() - extensionMinutes * 60000)
    : openMeasuredAt;
  const base = s.rateSegments.length
    ? freeHour
      ? 0
      : s.mode === "FIXED"
        ? fixedSegmentsAmount(s, segments, fixedPlannedEnd)
        : segments.reduce((sum, segment, index) => {
        const segmentEnd =
          segment.endedAt ??
          (s.mode === "FIXED" ? fixedPlannedEnd : openMeasuredAt);
        const segmentStart = index === 0 ? s.startedAt : segment.startedAt;
        if (segmentEnd <= segmentStart) return sum;
        const minutes = segmentMinutes(segmentStart, segmentEnd);
        return (
          sum +
          (s.mode === "OPEN"
            ? priceForOpenMinutes(
                segment.hourlyCents,
                segment.stationType,
                minutes,
              )
            : priceForBlocks(segment.hourlyCents, segment.stationType, minutes))
        );
        }, 0)
    : s.mode === "OPEN"
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
      sessionTotal(base, extensions, s.extras) +
      s.sales.reduce((sum, sale) => sum + sale.totalCents, 0),
    extensions,
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
      });
      if (
        !target ||
        ["CLOSED", "CANCELLED", "PAUSED", "SAVED"].includes(target.status)
      )
        throw new ApiError(404, "Sesión no disponible");
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
  function paymentLines(
    input:
      | {
          method: "CASH" | "YAPE" | "PLIN" | "CARD" | "TRANSFER" | "OTHER";
        }
      | {
          payments: {
            method: "CASH" | "YAPE" | "PLIN" | "CARD" | "TRANSFER" | "OTHER";
            amountCents: number;
          }[];
        },
    totalCents: number,
  ) {
    const lines = "payments" in input
      ? input.payments
      : [{ method: input.method, amountCents: totalCents }];
    if (lines.reduce((sum, line) => sum + line.amountCents, 0) !== totalCents)
      throw new ApiError(400, "Los pagos deben coincidir con el total");
    return lines;
  }
  async function closeRateSegment(
    tx: Prisma.TransactionClient,
    sessionId: string,
    endedAt: Date,
  ) {
    await tx.sessionRateSegment.updateMany({
      where: { sessionId, endedAt: null },
      data: { endedAt },
    });
  }
  async function openRateSegment(
    tx: Prisma.TransactionClient,
    sessionId: string,
    stationType: "PC" | "PS4" | "PS5" | "XBOX" | "NINTENDO_SWITCH" | "OTHER",
    hourlyCents: number,
    startedAt: Date,
  ) {
    await tx.sessionRateSegment.create({
      data: { sessionId, stationType, hourlyCents, startedAt },
    });
  }
  async function takePayment(
    tx: Prisma.TransactionClient,
    req: FastifyRequest,
    target: { sessionId?: string; saleId?: string },
    input:
      | {
          method: "CASH" | "YAPE" | "PLIN" | "CARD" | "TRANSFER" | "OTHER";
        }
      | {
          payments: {
            method: "CASH" | "YAPE" | "PLIN" | "CARD" | "TRANSFER" | "OTHER";
            amountCents: number;
          }[];
        },
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
        include: { sales: true, payments: true },
      });
      if (!session || session.status !== "TIME_FINISHED" || !session.finishedAt)
        throw new ApiError(
          409,
          "La sesión debe estar finalizada antes de cobrar",
        );
      amountCents = session.totalAmount - paidAmount(session);
      if (amountCents <= 0)
        throw new ApiError(409, "La sesión ya está pagada por completo");
      const lines = paymentLines(input, amountCents);
      const payments = [];
      for (const line of lines) {
        const payment = await tx.payment.create({
          data: {
            sessionId: session.id,
            cashRegisterId: register.id,
            method: line.method,
            amountCents: line.amountCents,
            createdBy: actor(req).id,
          },
        });
        payments.push(payment);
        await tx.cashMovement.create({
          data: {
            cashRegisterId: register.id,
            type: "PAYMENT",
            method: line.method,
            amount: line.amountCents,
            paymentId: payment.id,
            createdBy: actor(req).id,
          },
        });
      }
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
      await audit(tx, req, "SESSION_PAID", "Session", session.id, session, {
        payments,
        amountCents,
      });
      return payments.length === 1 ? payments[0] : { payments, amountCents };
    }
    const sale = await tx.sale.findUnique({ where: { id: target.saleId! } });
    if (!sale || sale.status !== "OPEN" || sale.sessionId)
      throw new ApiError(
        409,
        "La venta no está disponible para cobro independiente",
      );
    amountCents = sale.totalCents;
    const lines = paymentLines(input, amountCents);
    const payments = [];
    for (const line of lines) {
      const payment = await tx.payment.create({
        data: {
          saleId: sale.id,
          cashRegisterId: register.id,
          method: line.method,
          amountCents: line.amountCents,
          createdBy: actor(req).id,
        },
      });
      payments.push(payment);
      await tx.cashMovement.create({
        data: {
          cashRegisterId: register.id,
          type: "PAYMENT",
          method: line.method,
          amount: line.amountCents,
          paymentId: payment.id,
          createdBy: actor(req).id,
        },
      });
    }
    await tx.sale.update({ where: { id: sale.id }, data: { status: "PAID" } });
    await audit(tx, req, "SALE_PAID", "Sale", sale.id, sale, {
      payments,
      amountCents,
    });
    return payments.length === 1 ? payments[0] : { payments, amountCents };
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
              extensions: {
                include: {
                  adjustments: { orderBy: { createdAt: "asc" as const } },
                },
              },
              extras: true,
              sales: {
                include: {
                  items: { include: { product: { select: { category: true } } } },
                },
              },
            },
          },
          sale: {
            include: {
              items: { include: { product: { select: { category: true } } } },
            },
          },
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
      snacksCents = 0,
      beveragesCents = 0;
    const byMethod = new Map<string, number>(),
      byStation = new Map<string, { name: string; amountCents: number }>(),
      byProduct = new Map<
        string,
        { name: string; quantity: number; amountCents: number }
      >(),
      byHour = new Map<number, number>(),
      byDay = new Map<string, number>(),
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
    function addCategorizedPayment(
      amountCents: number,
      components: {
        category: "pc" | "playstation" | "extras" | "snacks" | "beverages";
        amountCents: number;
      }[],
    ) {
      const positive = components.filter((component) => component.amountCents > 0);
      const componentTotal = positive.reduce(
        (sum, component) => sum + component.amountCents,
        0,
      );
      if (!componentTotal || amountCents <= 0) return;
      let allocated = 0;
      positive.forEach((component, index) => {
        const share =
          index === positive.length - 1
            ? amountCents - allocated
            : Math.floor((component.amountCents * amountCents) / componentTotal);
        allocated += share;
        if (component.category === "pc") pcCents += share;
        if (component.category === "playstation") playstationCents += share;
        if (component.category === "extras") extrasCents += share;
        if (component.category === "snacks") snacksCents += share;
        if (component.category === "beverages") beveragesCents += share;
      });
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
          target.extensions.reduce(
            (sum, item) =>
              sum + (item.adjustments.at(-1)?.amountRemaining ?? item.amount),
            0,
          );
        const extraCents = target.extras.reduce(
          (sum, item) => sum + item.total,
          0,
        );
        let sessionSnacksCents = 0;
        let sessionBeveragesCents = 0;
        for (const sale of target.sales) {
          for (const item of sale.items) {
            if (item.product.category === "BEVERAGE") sessionBeveragesCents += item.subtotalCents;
            else sessionSnacksCents += item.subtotalCents;
          }
          addProducts(sale.items);
        }
        addCategorizedPayment(payment.amountCents, [
          {
            category: target.station.type === "PC" ? "pc" : "playstation",
            amountCents: timeCents,
          },
          { category: "extras", amountCents: extraCents },
          { category: "snacks", amountCents: sessionSnacksCents },
          { category: "beverages", amountCents: sessionBeveragesCents },
        ]);
      } else if (payment.sale) {
        const saleSnacksCents = payment.sale.items
          .filter((item) => item.product.category === "SNACK")
          .reduce((sum, item) => sum + item.subtotalCents, 0);
        const saleBeveragesCents = payment.sale.items
          .filter((item) => item.product.category === "BEVERAGE")
          .reduce((sum, item) => sum + item.subtotalCents, 0);
        addCategorizedPayment(payment.amountCents, [
          { category: "snacks", amountCents: saleSnacksCents },
          { category: "beverages", amountCents: saleBeveragesCents },
        ]);
        addProducts(payment.sale.items);
      }
    }
    const topStation =
      [...byStation.values()].sort(
        (a, b) => b.amountCents - a.amountCents,
      )[0] ?? null;
    const totalsByDay: { day: string; amountCents: number }[] = [];
    const totalsByWeekMap = new Map<string, number>();
    for (
      let cursor = from;
      cursor < to;
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const day = new Date(
        cursor.getTime() - REPORT_OFFSET_HOURS * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      const amountCents = byDay.get(day) ?? 0;
      totalsByDay.push({ day, amountCents });
      const weekStart = reportWeekStart(day);
      totalsByWeekMap.set(
        weekStart,
        (totalsByWeekMap.get(weekStart) ?? 0) + amountCents,
      );
    }
    const cashRegisters = await db.cashRegister.findMany({
      where: {
        openedAt: { lt: to },
        OR: [{ closedAt: null }, { closedAt: { gte: from } }],
      },
      include: { movements: true, payments: true },
      orderBy: { openedAt: "asc" },
    });
    const registerRows = cashRegisters
      .filter(
        (register) =>
          shift === "all" ||
          (shift === "morning" && register.shift === "MORNING") ||
          (shift === "afternoon" && register.shift === "AFTERNOON"),
      )
      .map((register) => {
        const paymentsInRange = register.payments.filter(
          (payment) =>
            payment.createdAt >= from &&
            payment.createdAt < to &&
            reportShiftMatches(payment.createdAt, shift),
        );
        const movementsInRange = register.movements.filter(
          (movement) =>
            movement.type !== "OPENING" &&
            movement.createdAt >= from &&
            movement.createdAt < to &&
            reportShiftMatches(movement.createdAt, shift),
        );
        const expectedCents =
          register.expectedAmount ??
          register.openingAmount +
            register.movements
              .filter((movement) => movement.method === "CASH")
              .reduce(
                (sum, movement) =>
                  sum +
                  (movement.type === "WITHDRAWAL"
                    ? -movement.amount
                    : movement.amount),
                0,
              );
        return {
          id: register.id,
          status: register.status,
          shift: register.shift,
          openedAt: register.openedAt,
          closedAt: register.closedAt,
          openingAmountCents: register.openingAmount,
          nextOpeningAmountCents: register.nextOpeningAmount,
          cashSalesCents: paymentsInRange
            .filter((payment) => payment.method === "CASH")
            .reduce((sum, payment) => sum + payment.amountCents, 0),
          digitalSalesCents: paymentsInRange
            .filter((payment) => payment.method !== "CASH")
            .reduce((sum, payment) => sum + payment.amountCents, 0),
          movementCents: movementsInRange.reduce(
            (sum, movement) =>
              sum +
              (movement.type === "WITHDRAWAL"
                ? -movement.amount
                : movement.amount),
            0,
          ),
          expectedAmountCents: expectedCents,
          closingAmountCents: register.closingAmount,
          differenceCents: register.difference,
          openedBy: register.openedBy,
          closedBy: register.closedBy,
        };
      });
    const reportUserIds = [
      ...new Set(
        registerRows.flatMap((row) =>
          [row.openedBy, row.closedBy].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    ];
    const reportUsers = await db.user.findMany({
      where: { id: { in: reportUserIds } },
      select: { id: true, name: true },
    });
    const reportUserNames = new Map(
      reportUsers.map((reportUser) => [reportUser.id, reportUser.name]),
    );
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      totalCents,
      categories: {
        pcCents,
        playstationCents,
        extrasCents,
        snacksCents,
        beveragesCents,
      },
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
      totalsByDay,
      totalsByWeek: [...totalsByWeekMap.entries()]
        .map(([weekStart, amountCents]) => ({ weekStart, amountCents }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
      cashControl: {
        cashSalesCents: byMethod.get("CASH") ?? 0,
        digitalSalesCents: totalCents - (byMethod.get("CASH") ?? 0),
        registers: registerRows.map((row) => ({
          ...row,
          openedByName: reportUserNames.get(row.openedBy) ?? "Usuario eliminado",
          closedByName: row.closedBy
            ? reportUserNames.get(row.closedBy) ?? "Usuario eliminado"
            : null,
        })),
      },
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
      where: { active: true },
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
  app.delete("/users/:id", async (req) => {
    const current = actor(req);
    admin(req);
    const id = idOf(req);
    if (id === current.id)
      throw new ApiError(409, "No puedes eliminar tu propio usuario");
    return mutate(req, async (tx) => {
      const old = await tx.user.findUnique({ where: { id } });
      if (!old || !old.active)
        throw new ApiError(404, "Trabajador no encontrado");
      if (old.role === "ADMIN") {
        const activeAdmins = await tx.user.count({
          where: { role: "ADMIN", active: true },
        });
        if (activeAdmins <= 1)
          throw new ApiError(
            409,
            "Debe quedar al menos un administrador activo",
          );
      }
      const u = await tx.user.update({
        where: { id },
        data: { active: false },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      await audit(tx, req, "USER_DELETED", "User", id, old, u);
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
        throw new ApiError(409, "Elige o canjea el premio disponible antes de seguir acumulando sellos");
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
          freeHourAvailable: stampCount === 6 || stampCount === 12,
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
        if (![6, 12].includes(card.stampCount) || !card.freeHourAvailable)
          throw new ApiError(409, "La hora gratis se habilita al completar 6 o 12 sellos");
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
            rateSegments: {
              create: { stationType: station.type, hourlyCents, startedAt: now },
            },
          },
        });
        await tx.station.update({ where: { id: station.id }, data: { status: "IN_USE" } });
        const redemption = await tx.loyaltyRedemption.create({
          data: {
            cardId: id,
            rewardType: "FREE_HOUR",
            stampsUsed: card.stampCount,
            promotionValueCents: hourlyCents,
            createdBy: actor(req).id,
          },
        });
        const completedFullCard = card.stampCount === 12;
        const updated = await tx.loyaltyCard.update({
          where: { id },
          data: completedFullCard
            ? { stampCount: 0, freeHourAvailable: false, snackKitAvailable: false }
            : { freeHourAvailable: false },
          include: loyaltyCardInclude,
        });
        await audit(tx, req, "SESSION_STARTED", "Session", freeSession.id, null, { ...freeSession, loyaltyCardId: id });
        await audit(tx, req, "LOYALTY_FREE_HOUR_REDEEMED", "LoyaltyCard", id, card, { updated, redemption, freeSessionId: freeSession.id });
        return { ...updated, freeSessionId: freeSession.id };
      }
      if (card.stampCount !== 12 || !card.snackKitAvailable)
        throw new ApiError(409, "El kit de snacks se habilita al completar 12 sellos");
      const configuredKit = await tx.setting.findMany({
        where: { key: { in: ["LOYALTY_SODA_PRODUCT_ID", "LOYALTY_SNACK_PRODUCT_ID"] } },
      });
      const sodaProductId =
        input.sodaProductId ??
        configuredKit.find((setting) => setting.key === "LOYALTY_SODA_PRODUCT_ID")?.value;
      const snackProductId =
        input.snackProductId ??
        configuredKit.find((setting) => setting.key === "LOYALTY_SNACK_PRODUCT_ID")?.value;
      if (!sodaProductId || !snackProductId)
        throw new ApiError(400, "Configura la bebida y el snack del kit en Configuración");
      if (sodaProductId === snackProductId)
        throw new ApiError(400, "La bebida y el snack deben ser productos distintos");
      const kitProducts = await tx.product.findMany({
        where: {
          id: { in: [sodaProductId, snackProductId] },
          active: true,
        },
      });
      const soda = kitProducts.find((product) => product.id === sodaProductId);
      const snack = kitProducts.find((product) => product.id === snackProductId);
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
            "LOYALTY_SODA_PRODUCT_ID",
            "LOYALTY_SNACK_PRODUCT_ID",
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
      LOYALTY_SODA_PRODUCT_ID:
        rows.find((row) => row.key === "LOYALTY_SODA_PRODUCT_ID")?.value ?? "",
      LOYALTY_SNACK_PRODUCT_ID:
        rows.find((row) => row.key === "LOYALTY_SNACK_PRODUCT_ID")?.value ?? "",
    };
  });
  app.get("/settings/loyalty-kit", async (req) => {
    actor(req);
    const rows = await db.setting.findMany({
      where: { key: { in: ["LOYALTY_SODA_PRODUCT_ID", "LOYALTY_SNACK_PRODUCT_ID"] } },
    });
    return {
      sodaProductId: rows.find((row) => row.key === "LOYALTY_SODA_PRODUCT_ID")?.value ?? "",
      snackProductId: rows.find((row) => row.key === "LOYALTY_SNACK_PRODUCT_ID")?.value ?? "",
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
    if (
      input.key === "LOYALTY_SODA_PRODUCT_ID" ||
      input.key === "LOYALTY_SNACK_PRODUCT_ID"
    ) {
      if (input.value) {
        const product = await db.product.findUnique({ where: { id: input.value } });
        const expectedCategory =
          input.key === "LOYALTY_SODA_PRODUCT_ID" ? "BEVERAGE" : "SNACK";
        if (!product?.active || product.category !== expectedCategory)
          throw new ApiError(
            400,
            input.key === "LOYALTY_SODA_PRODUCT_ID"
              ? "Selecciona un producto activo clasificado como bebida"
              : "Selecciona un producto activo clasificado como snack",
          );
      }
    }
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
        value: [
          "NOTIFICATION_SOUND",
          "LOYALTY_SODA_PRODUCT_ID",
          "LOYALTY_SNACK_PRODUCT_ID",
        ].includes(input.key)
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
          rateSegments: {
            create: { stationType: s.type, hourlyCents, startedAt: now },
          },
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
          hourlyCents: old.hourlyCents,
          stationType: old.station.type,
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
  app.post("/sessions/:id/extensions/:extensionId/adjust", async (req) => {
    const id = idOf(req);
    const { extensionId } = z
      .object({ extensionId: z.string().uuid() })
      .parse(req.params);
    const input = adjustExtensionInput.parse(req.body);
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        editable(old);
        if (old.mode !== "FIXED" || !old.endsAt)
          throw new ApiError(409, "Solo se ajustan extensiones de sesiones fijas");
        if (old.payments.length)
          throw new ApiError(409, "No se ajusta una extensión después de registrar pagos");
        const extension = old.extensions.find((item) => item.id === extensionId);
        if (!extension) throw new ApiError(404, "Extensión no encontrada");
        const previous = extension.adjustments.at(-1);
        const currentMinutes = previous?.minutesRemaining ?? extension.minutesAdded;
        const currentAmount = previous?.amountRemaining ?? extension.amount;
        const rateAtCreation = [...old.rateSegments]
          .reverse()
          .find(
            (segment) =>
              segment.startedAt <= extension.createdAt &&
              (!segment.endedAt || segment.endedAt >= extension.createdAt),
          );
        const snapshotHourlyCents =
          extension.hourlyCents ?? rateAtCreation?.hourlyCents ?? null;
        const snapshotStationType =
          extension.stationType ?? rateAtCreation?.stationType ?? null;
        if (input.minutes >= currentMinutes)
          throw new ApiError(409, "El nuevo tiempo debe ser menor al de la extensión actual");
        if (snapshotHourlyCents === null || snapshotStationType === null)
          throw new ApiError(409, "Esta extensión antigua no conserva la tarifa necesaria para recalcularla");
        if (
          !previous &&
          priceForBlocks(
            snapshotHourlyCents,
            snapshotStationType,
            extension.minutesAdded,
          ) !== extension.amount
        )
          throw new ApiError(409, "No coincide el importe histórico de esta extensión; no se alteró su cobro");
        const amountRemaining = priceForBlocks(
          snapshotHourlyCents,
          snapshotStationType,
          input.minutes,
        );
        const amountCredited = currentAmount - amountRemaining;
        if (amountCredited <= 0)
          throw new ApiError(409, "El ajuste no genera una diferencia de cobro");
        await tx.sessionExtensionAdjustment.create({
          data: {
            extensionId,
            minutesRemaining: input.minutes,
            amountRemaining,
            createdBy: actor(req).id,
          },
        });
        const updated = await tx.session.update({
          where: { id },
          data: {
            endsAt: new Date(old.endsAt.getTime() - (currentMinutes - input.minutes) * 60000),
            totalAmount: { decrement: amountCredited },
            status: "ACTIVE",
          },
          include: details,
        });
        await audit(tx, req, "SESSION_EXTENSION_ADJUSTED", "Session", id, old, {
          session: updated,
          extensionId,
          previousMinutes: currentMinutes,
          minutesRemaining: input.minutes,
          amountCredited,
          amountRemaining,
        });
        return view(updated, new Date());
      },
      events.sessionExtended,
    );
  });
  app.post("/sessions/:id/extras", async (req) => {
    const id = idOf(req),
      input = addExtraInput.parse(req.body);
    return mutate(req, async (tx) => {
      const old = await session(tx, id);
      editable(old);
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
          select: {
            id: true,
            name: true,
            type: true,
            active: true,
            status: true,
            rates: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { hourlyCents: true },
            },
          },
        });
        if (!target?.active)
          throw new ApiError(404, "Estación de destino no encontrada");
        const consoleMove =
          ["PS4", "PS5"].includes(old.station.type) &&
          ["PS4", "PS5"].includes(target.type);
        if (target.type !== old.station.type && !consoleMove)
          throw new ApiError(
            409,
            "Solo puedes mover entre estaciones del mismo tipo; PS4 y PS5 son compatibles entre sí",
          );
        const targetHourlyCents = target.rates[0]?.hourlyCents;
        if (!targetHourlyCents)
          throw new ApiError(409, "Configura una tarifa para la estación de destino");
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
        const now = new Date();
        const lastSegment = old.rateSegments.at(-1);
        const rateChanged =
          !lastSegment ||
          lastSegment.stationType !== target.type ||
          lastSegment.hourlyCents !== targetHourlyCents;
        if (rateChanged) {
          await closeRateSegment(tx, id, now);
          await openRateSegment(tx, id, target.type, targetHourlyCents, now);
        }
        const moved = await tx.session.update({
          where: { id },
          data: { stationId: target.id, hourlyCents: targetHourlyCents },
          include: details,
        });
        const recalculated = view(moved, now);
        const updated = await tx.session.update({
          where: { id },
          data: {
            baseAmount: recalculated.baseAmount,
            totalAmount: recalculated.totalAmount,
          },
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
    const input = sessionFinishInput.parse(req.body ?? {});
    return mutate(req, async (tx) => {
      const old = await session(tx, id);
      editable(old);
      const now = new Date();
      const computed = view(old, now);
      if (input.billUsedTime) {
        if (old.mode !== "FIXED")
          throw new ApiError(409, "El tiempo libre ya cobra según lo utilizado");
        if (old.payments.length)
          throw new ApiError(409, "Una sesión ya pagada debe cerrarse con su pago registrado");
        if (old.extensions.length)
          throw new ApiError(409, "Finaliza primero las extensiones agregadas");
      }
      await closeRateSegment(
        tx,
        id,
        old.mode === "FIXED"
          ? old.endsAt
            ? new Date(
                old.endsAt.getTime() -
                  old.extensions.reduce(
                    (sum, extension) =>
                      sum +
                      (extension.adjustments.at(-1)?.minutesRemaining ??
                        extension.minutesAdded),
                    0,
                  ) *
                    60000,
              )
            : now
          : now,
      );
      const usedMinutes = input.billUsedTime ? usedFixedMinutes(old, now) : null;
      const usedAmount = input.billUsedTime ? usedFixedAmount(old, now) : null;
      const finalBaseAmount = input.billUsedTime ? usedAmount! : computed.baseAmount;
      const finalTotalAmount = input.billUsedTime
        ? sessionTotal(finalBaseAmount, [], old.extras) +
          old.sales.reduce((sum, sale) => sum + sale.totalCents, 0)
        : computed.totalAmount;
      const fullyPaid = paidAmount(old) >= finalTotalAmount;
      const closesFreeHour = !old.payments.length && computed.totalAmount === 0;
      const updated = await tx.session.update({
        where: { id },
        data: {
          status: fullyPaid || closesFreeHour ? "CLOSED" : "TIME_FINISHED",
          finishedAt: now,
          ...(input.billUsedTime ? { baseMinutes: usedMinutes } : {}),
          baseAmount: finalBaseAmount,
          totalAmount: finalTotalAmount,
          ...(fullyPaid || closesFreeHour
            ? { closedAt: now, closedBy: actor(req).id }
            : {}),
        },
        include: details,
      });
      await tx.station.update({
        where: { id: old.stationId },
        data: { status: fullyPaid || closesFreeHour ? "AVAILABLE" : "FINISHED" },
      });
      await audit(
        tx,
        req,
        fullyPaid && old.payments.length
          ? "SESSION_FINISHED_PREPAID"
          : input.billUsedTime
            ? "SESSION_FINISHED_USED_TIME"
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
  app.post("/sessions/:id/open", async (req) => {
    const id = idOf(req);
    z.object({}).strict().parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        editable(old);
        if (old.mode !== "FIXED")
          throw new ApiError(409, "La sesión ya está en tiempo libre");
        if (old.payments.length)
          throw new ApiError(409, "Una sesión ya pagada no puede cambiar a tiempo libre");
        if (old.extensions.length)
          throw new ApiError(409, "Finaliza primero las extensiones agregadas");
        const now = new Date();
        if (old.endsAt && old.endsAt <= now)
          throw new ApiError(409, "La sesión ya terminó");
        await closeRateSegment(tx, id, now);
        await openRateSegment(tx, id, old.station.type, old.hourlyCents, now);
        const changed = await tx.session.update({
          where: { id },
          data: { mode: "OPEN", baseMinutes: null, endsAt: null },
          include: details,
        });
        const recalculated = view(changed, now);
        const updated = await tx.session.update({
          where: { id },
          data: {
            baseAmount: recalculated.baseAmount,
            totalAmount: recalculated.totalAmount,
          },
          include: details,
        });
        await audit(tx, req, "SESSION_CHANGED_TO_OPEN", "Session", id, old, updated);
        return view(updated, now);
      },
      events.sessionUpdated,
    );
  });
  app.post("/sessions/:id/round", async (req) => {
    const id = idOf(req);
    const input = sessionRoundInput.parse(req.body ?? {});
    return mutate(
      req,
      async (tx) => {
        const old = await session(tx, id);
        editable(old);
        if (old.mode !== "OPEN")
          throw new ApiError(409, "Solo las sesiones libres pueden redondearse");
        if (old.payments.length)
          throw new ApiError(409, "Una sesión ya pagada no puede redondearse");
        const now = new Date();
        const elapsedMinutes = usedFixedMinutes(old, now);
        if (input.minutes <= elapsedMinutes)
          throw new ApiError(409, "El redondeo debe ser mayor al tiempo utilizado");
        await closeRateSegment(tx, id, now);
        await openRateSegment(tx, id, old.station.type, old.hourlyCents, now);
        const changed = await tx.session.update({
          where: { id },
          data: {
            mode: "FIXED",
            baseMinutes: input.minutes,
            endsAt: new Date(
              now.getTime() + (input.minutes - elapsedMinutes) * 60000,
            ),
            status: "ACTIVE",
          },
          include: details,
        });
        const recalculated = view(changed, now);
        const updated = await tx.session.update({
          where: { id },
          data: {
            baseAmount: recalculated.baseAmount,
            totalAmount: recalculated.totalAmount,
          },
          include: details,
        });
        await audit(tx, req, "SESSION_ROUNDED_TO_FIXED", "Session", id, old, {
          session: updated,
          elapsedMinutes,
          roundedMinutes: input.minutes,
        });
        return view(updated, now);
      },
      events.sessionUpdated,
    );
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
        await closeRateSegment(tx, id, now);
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
        const now = new Date();
        await closeRateSegment(tx, id, now);
        const updated = await tx.session.update({
          where: { id },
          data: {
            status: "CANCELLED",
            finishedAt: now,
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
      input = paymentInput.or(splitPaymentInput).parse(req.body);
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
        const lines = paymentLines(input, current.totalAmount);
        const payments = [];
        for (const line of lines) {
          const payment = await tx.payment.create({
            data: {
              sessionId: id,
              cashRegisterId: register.id,
              method: line.method,
              amountCents: line.amountCents,
              createdBy: actor(req).id,
            },
          });
          payments.push(payment);
          await tx.cashMovement.create({
            data: {
              cashRegisterId: register.id,
              type: "PAYMENT",
              method: line.method,
              amount: line.amountCents,
              paymentId: payment.id,
              createdBy: actor(req).id,
            },
          });
        }
        await tx.session.update({
          where: { id },
          data: { totalAmount: current.totalAmount },
        });
        await tx.sale.updateMany({
          where: { sessionId: id, status: "OPEN" },
          data: { status: "PAID" },
        });
        await audit(tx, req, "SESSION_PREPAID", "Session", id, old, {
          payments,
          amountCents: current.totalAmount,
        });
        return payments.length === 1
          ? payments[0]
          : { payments, amountCents: current.totalAmount };
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
        await closeRateSegment(tx, id, now);
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
          select: {
            id: true,
            type: true,
            active: true,
            status: true,
            rates: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { hourlyCents: true },
            },
          },
        });
        if (!original?.active)
          throw new ApiError(409, "La estación original no está disponible");
        const target = input.stationId
          ? await tx.station.findUnique({
              where: { id: input.stationId },
              select: {
                id: true,
                type: true,
                active: true,
                status: true,
                rates: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { hourlyCents: true },
                },
              },
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
                select: {
                  id: true,
                  type: true,
                  active: true,
                  status: true,
                  rates: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { hourlyCents: true },
                  },
                },
              });
        const consoleResume =
          ["PS4", "PS5"].includes(original.type) &&
          ["PS4", "PS5"].includes(target?.type ?? "");
        if (
          !target ||
          !target.active ||
          (target.type !== original.type && !consoleResume) ||
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
        const targetHourlyCents = target.rates[0]?.hourlyCents ?? old.hourlyCents;
        await closeRateSegment(tx, id, now);
        await openRateSegment(tx, id, target.type, targetHourlyCents, now);
        const updated = await tx.session.update({
          where: { id },
          data: {
            stationId: target.id,
            hourlyCents: targetHourlyCents,
            startedAt: isOpen
              ? new Date(
                  old.startedAt.getTime() +
                    (now.getTime() - old.pausedAt!.getTime()),
                )
              : old.startedAt,
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
    const closedRegister = await db.cashRegister.findFirst({
      where: { status: "CLOSED", closingAmount: { not: null } },
      orderBy: { closedAt: "desc" },
      select: {
        id: true,
        shift: true,
        openingAmount: true,
        closingAmount: true,
        nextOpeningAmount: true,
        expectedAmount: true,
        difference: true,
        openedAt: true,
        closedAt: true,
        openedBy: true,
        closedBy: true,
      },
    });
    const lastClosed = closedRegister
      ? {
          ...closedRegister,
          nextOpeningAmount:
            closedRegister.nextOpeningAmount ?? closedRegister.closingAmount,
        }
      : null;
    if (!register) return { register: null, lastClosed };
    const expectedAmount =
      register.openingAmount +
      register.movements
        .filter((m) => m.method === "CASH" && m.type !== "OPENING")
        .reduce(
          (sum, m) => sum + (m.type === "WITHDRAWAL" ? -m.amount : m.amount),
          0,
        );
    const cashPaymentsCents = register.payments
      .filter((payment) => payment.method === "CASH")
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const digitalPaymentsCents = register.payments
      .filter((payment) => payment.method !== "CASH")
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    return {
      register: {
        ...register,
        expectedAmount,
        cashPaymentsCents,
        digitalPaymentsCents,
      },
      lastClosed,
    };
  });
  app.post("/cash/open", async (req) => {
    const data = cashOpenInput.parse(req.body);
    return mutate(req, async (tx) => {
      if (await tx.cashRegister.findFirst({ where: { status: "OPEN" } }))
        throw new ApiError(409, "Ya existe una caja abierta");
      const register = await tx.cashRegister.create({
        data: {
          openingAmount: data.openingAmount,
          shift: data.shift,
          openedBy: actor(req).id,
        },
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
      const nextOpeningAmount = data.nextOpeningAmount ?? data.closingAmount;
      if (nextOpeningAmount > data.closingAmount)
        throw new ApiError(
          400,
          "El sencillo del siguiente turno no puede superar el efectivo contado.",
        );
      const closed = await tx.cashRegister.update({
        where: { id: register.id },
        data: {
          status: "CLOSED",
          closingAmount: data.closingAmount,
          nextOpeningAmount,
          expectedAmount,
          difference: data.closingAmount - expectedAmount,
          closedBy: actor(req).id,
          closedAt: new Date(),
        },
      });
      const withdrawalAmount = data.closingAmount - nextOpeningAmount;
      if (withdrawalAmount > 0)
        await tx.cashMovement.create({
          data: {
            cashRegisterId: register.id,
            type: "WITHDRAWAL",
            amount: withdrawalAmount,
            method: "CASH",
            reason: `Retiro de cierre; se deja ${nextOpeningAmount / 100} para el siguiente turno`,
            createdBy: actor(req).id,
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
      input = paymentInput.or(splitPaymentInput).parse(req.body);
    return mutate(req, (tx) => takePayment(tx, req, { sessionId: id }, input));
  });
  app.post("/sales/:id/pay", async (req) => {
    const id = idOf(req),
      input = paymentInput.or(splitPaymentInput).parse(req.body);
    return mutate(req, (tx) => takePayment(tx, req, { saleId: id }, input));
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
