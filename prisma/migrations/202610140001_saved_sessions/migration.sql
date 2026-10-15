ALTER TYPE "SessionStatus" ADD VALUE 'SAVED';
ALTER TABLE "Session" ADD COLUMN "savedCode" TEXT;
ALTER TABLE "Session" ADD COLUMN "savedAt" TIMESTAMPTZ(3);
ALTER TABLE "Session" ADD COLUMN "savedName" TEXT;
CREATE UNIQUE INDEX "Session_savedCode_key" ON "Session"("savedCode");
