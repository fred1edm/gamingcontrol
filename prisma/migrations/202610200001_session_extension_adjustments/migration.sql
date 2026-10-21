ALTER TABLE "SessionExtension"
ADD COLUMN "hourlyCents" INTEGER,
ADD COLUMN "stationType" "StationType";

CREATE TABLE "SessionExtensionAdjustment" (
    "id" UUID NOT NULL,
    "extensionId" UUID NOT NULL,
    "minutesRemaining" INTEGER NOT NULL,
    "amountRemaining" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionExtensionAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionExtensionAdjustment_extensionId_createdAt_idx"
ON "SessionExtensionAdjustment"("extensionId", "createdAt");

ALTER TABLE "SessionExtensionAdjustment"
ADD CONSTRAINT "SessionExtensionAdjustment_extensionId_fkey"
FOREIGN KEY ("extensionId") REFERENCES "SessionExtension"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
