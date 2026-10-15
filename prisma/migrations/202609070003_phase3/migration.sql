-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'YAPE', 'PLIN', 'CARD', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CashRegisterStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'PAYMENT', 'INCOME', 'WITHDRAWAL', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "SaleStatus" ADD VALUE 'PAID';

-- CreateTable
CREATE TABLE "CashRegister" (
    "id" UUID NOT NULL,
    "status" "CashRegisterStatus" NOT NULL DEFAULT 'OPEN',
    "openingAmount" INTEGER NOT NULL,
    "closingAmount" INTEGER,
    "expectedAmount" INTEGER,
    "difference" INTEGER,
    "openedBy" UUID NOT NULL,
    "closedBy" UUID,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "cashRegisterId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "reason" TEXT,
    "paymentId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "sessionId" UUID,
    "saleId" UUID,
    "cashRegisterId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashRegister_status_openedAt_idx" ON "CashRegister"("status", "openedAt");

-- CreateIndex
CREATE INDEX "CashMovement_cashRegisterId_createdAt_idx" ON "CashMovement"("cashRegisterId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_cashRegisterId_createdAt_idx" ON "Payment"("cashRegisterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_sessionId_key" ON "Payment"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_saleId_key" ON "Payment"("saleId");

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
