-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('PC', 'PS4', 'PS5', 'XBOX', 'NINTENDO_SWITCH', 'OTHER');

-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'ENDING_SOON', 'FINISHED', 'OFFLINE', 'MAINTENANCE', 'RESERVED');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('FIXED', 'OPEN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDING_SOON', 'TIME_FINISHED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('ONE_TIME_PER_SESSION');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StationType" NOT NULL,
    "status" "StationStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationRate" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "hourlyCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "startedBy" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "mode" "SessionMode" NOT NULL,
    "baseMinutes" INTEGER,
    "baseAmount" INTEGER NOT NULL,
    "hourlyCents" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closedBy" UUID,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionExtension" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "minutesAdded" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extra" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "chargeType" "ChargeType" NOT NULL DEFAULT 'ONE_TIME_PER_SESSION',

    CONSTRAINT "Extra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionExtra" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "extraId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "chargeType" "ChargeType" NOT NULL DEFAULT 'ONE_TIME_PER_SESSION',
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idempotency" (
    "key" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Station_name_key" ON "Station"("name");

-- CreateIndex
CREATE INDEX "StationRate_stationId_createdAt_idx" ON "StationRate"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_stationId_startedAt_idx" ON "Session"("stationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Extra_name_key" ON "Extra"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SessionExtra_sessionId_extraId_key" ON "SessionExtra"("sessionId", "extraId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "StationRate" ADD CONSTRAINT "StationRate_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExtension" ADD CONSTRAINT "SessionExtension_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExtra" ADD CONSTRAINT "SessionExtra_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExtra" ADD CONSTRAINT "SessionExtra_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "Extra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One unfinished / unpaid session per station, including TIME_FINISHED.
CREATE UNIQUE INDEX "Session_one_open_per_station" ON "Session" ("stationId") WHERE "status" NOT IN ('CLOSED', 'CANCELLED');
ALTER TABLE "StationRate" ADD CONSTRAINT "StationRate_positive" CHECK ("hourlyCents" > 0);
ALTER TABLE "Extra" ADD CONSTRAINT "Extra_nonnegative" CHECK ("priceCents" >= 0);
ALTER TABLE "Session" ADD CONSTRAINT "Session_money_nonnegative" CHECK ("baseAmount" >= 0 AND "totalAmount" >= 0 AND "hourlyCents" > 0);
ALTER TABLE "Session" ADD CONSTRAINT "Session_mode_consistent" CHECK (("mode"='FIXED' AND "baseMinutes" IS NOT NULL AND "baseMinutes">0 AND "endsAt" IS NOT NULL) OR ("mode"='OPEN' AND "baseMinutes" IS NULL AND "endsAt" IS NULL));
ALTER TABLE "SessionExtra" ADD CONSTRAINT "SessionExtra_total_consistent" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "total" = "quantity" * "unitPrice");
ALTER TABLE "SessionExtension" ADD CONSTRAINT "SessionExtension_positive" CHECK ("minutesAdded" > 0 AND "amount" >= 0);
