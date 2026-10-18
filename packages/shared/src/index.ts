import { z } from "zod";
export const stationTypes = [
  "PC",
  "PS4",
  "PS5",
  "XBOX",
  "NINTENDO_SWITCH",
  "OTHER",
] as const;
export const money = z.number().int().min(0).max(1_000_000);
export const loginInput = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
export const userInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().min(12).max(128),
  role: z.enum(["ADMIN", "EMPLOYEE"]),
});
export const userUpdateInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  role: z.enum(["ADMIN", "EMPLOYEE"]),
});
export const passwordResetInput = z.object({
  password: z.string().min(12).max(128),
});
export const stationInput = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(stationTypes),
  hourlyCents: money.refine((n) => n > 0),
});
export const rateInput = z.object({ hourlyCents: money.refine((n) => n > 0) });
export const extraInput = z.object({
  name: z.string().trim().min(1).max(80),
  priceCents: money,
  active: z.boolean().default(true),
});
export const startInput = z
  .object({
    stationId: z.string().uuid(),
    mode: z.enum(["FIXED", "OPEN"]),
    minutes: z.number().int().min(1).max(1440).optional(),
    extraId: z.string().uuid().optional(),
    extraQuantity: z.number().int().min(1).max(4).default(1),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "FIXED" && !v.minutes)
      ctx.addIssue({
        code: "custom",
        message: "Indica los minutos",
        path: ["minutes"],
      });
    if (v.mode === "OPEN" && v.minutes !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "Tiempo libre no admite minutos",
        path: ["minutes"],
      });
  });
export const extendInput = z.object({
  minutes: z.union([
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(120),
  ]),
});
export const addExtraInput = z.object({
  extraId: z.string().uuid(),
  quantity: z.number().int().min(1).max(4).default(1),
});
export const productInput = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(40).optional().nullable(),
  category: z.enum(["BEVERAGE", "SNACK"]).default("SNACK"),
  stockMinimum: z.number().int().min(0).max(1000000).default(0),
  salePriceCents: money.refine((n) => n > 0),
  costCents: money.optional().nullable(),
  active: z.boolean().default(true),
});
export const stockInput = z.object({
  quantity: z.number().int().min(1).max(1000000),
  type: z.enum(["PURCHASE", "ADJUSTMENT", "LOSS", "RETURN"]),
  unitCostCents: money.optional(),
  reason: z.string().trim().max(240).optional(),
});
export const saleItemInput = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
});
export const saleInput = z.object({
  sessionId: z.string().uuid().optional().nullable(),
  items: z.array(saleItemInput).min(1).max(50),
});
export const paymentInput = z.object({
  method: z.enum(["CASH", "YAPE", "PLIN", "CARD", "TRANSFER", "OTHER"]),
});
export const sessionSaveInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});
export const sessionResumeInput = z.object({
  stationId: z.string().uuid().optional(),
});
export const sessionMoveInput = z.object({
  stationId: z.string().uuid(),
});
export const cashOpenInput = z.object({ openingAmount: money });
export const cashCloseInput = z.object({ closingAmount: money });
export const cashMovementInput = z.object({
  type: z.enum(["INCOME", "WITHDRAWAL", "ADJUSTMENT"]),
  amount: money.refine((n) => n > 0),
  reason: z.string().trim().min(2).max(240),
});
export const notificationSoundOptions = [
  { value: "fahhhhh", label: "Fahhhhh (actual)", file: "/notification.mp3" },
  {
    value: "mario-game-over",
    label: "Mario Game Over",
    file: "/sounds/mario-game-over.mp3",
  },
  {
    value: "game-over-hon",
    label: "Game Over - HoN",
    file: "/sounds/game-over-hon.mp3",
  },
  {
    value: "halo-game-over",
    label: "Halo Game Over",
    file: "/sounds/halo-game-over.mp3",
  },
  {
    value: "game-over-v2",
    label: "Game Over v2.0",
    file: "/sounds/game-over-v2.mp3",
  },
] as const;
export const notificationSoundValues = notificationSoundOptions.map(
  ({ value }) => value,
) as [string, ...string[]];
const notificationSoundInput = z.enum(notificationSoundValues);
export const settingInput = z.union([
  z.object({
    key: z.enum(["ALERT_FIRST_MINUTES", "ALERT_SECOND_MINUTES"]),
    value: z.number().int().min(1).max(120),
  }),
  z.object({
    key: z.literal("NOTIFICATION_SOUND"),
    value: notificationSoundInput,
  }),
]);
export const events = {
  stationUpdated: "station:updated",
  sessionStarted: "session:started",
  sessionUpdated: "session:updated",
  sessionExtended: "session:extended",
  sessionEndingSoon: "session:ending-soon",
  sessionFinished: "session:finished",
  saleCreated: "sale:created",
  inventoryUpdated: "inventory:updated",
  loyaltyUpdated: "loyalty:updated",
  cashUpdated: "cash:updated",
  settingsUpdated: "settings:updated",
  notificationNew: "notification:new",
} as const;
export type UserView = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE";
};
export type ExtraView = {
  id: string;
  name: string;
  priceCents: number;
  active: boolean;
};
export type SessionView = {
  id: string;
  stationId: string;
  mode: "FIXED" | "OPEN";
  status: string;
  startedAt: string;
  endsAt: string | null;
  finishedAt: string | null;
  baseMinutes: number | null;
  baseAmount: number;
  hourlyCents: number;
  totalAmount: number;
  savedCode?: string | null;
  savedName?: string | null;
  savedRemainingSeconds?: number | null;
  pausedRemainingSeconds?: number | null;
  extensions: {
    id: string;
    minutesAdded: number;
    amount: number;
    createdAt: string;
  }[];
  extras: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    chargeType: string;
  }[];
  sales: {
    id: string;
    status: string;
    totalCents: number;
    items: {
      id: string;
      productName: string;
      unitPriceCents: number;
      quantity: number;
      subtotalCents: number;
      createdAt: string;
    }[];
  }[];
  payments?: {
    id: string;
    method: string;
    amountCents: number;
    createdAt: string;
  }[];
};
export type StationView = {
  id: string;
  name: string;
  type: (typeof stationTypes)[number];
  status: string;
  hourlyCents: number;
  session: SessionView | null;
};
export type StationsResponse = { stations: StationView[]; serverTime: string };
export type ProductView = {
  id: string;
  name: string;
  category: "BEVERAGE" | "SNACK";
  sku: string | null;
  stockCurrent: number;
  stockMinimum: number;
  salePriceCents: number;
  costCents: number | null;
  active: boolean;
};
export type LoyaltyCardView = {
  id: string;
  customerName: string;
  stampCount: number;
  freeHourAvailable: boolean;
  snackKitAvailable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  redemptions: {
    id: string;
    rewardType: "FREE_HOUR" | "SNACK_KIT";
    stampsUsed: number;
    promotionValueCents: number;
    sodaProductName: string | null;
    snackProductName: string | null;
    createdAt: string;
  }[];
};
export const loyaltyStampInput = z.object({
  quantity: z.number().int().min(1).max(12).default(1),
});
export const loyaltyRedeemInput = z.object({
  rewardType: z.enum(["FREE_HOUR", "SNACK_KIT"]),
  stationId: z.string().uuid().optional(),
  sodaProductId: z.string().uuid().optional(),
  snackProductId: z.string().uuid().optional(),
});
