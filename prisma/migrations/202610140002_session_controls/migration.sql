ALTER TYPE "SessionStatus" ADD VALUE 'PAUSED';
ALTER TABLE "Session" ADD COLUMN "savedRemainingSeconds" INTEGER;
ALTER TABLE "Session" ADD COLUMN "pausedAt" TIMESTAMPTZ(3);
ALTER TABLE "Session" ADD COLUMN "pausedRemainingSeconds" INTEGER;
