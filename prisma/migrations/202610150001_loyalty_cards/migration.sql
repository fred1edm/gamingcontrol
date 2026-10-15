CREATE TYPE "LoyaltyRewardType" AS ENUM ('FREE_HOUR', 'SNACK_KIT');

CREATE TABLE "LoyaltyCard" (
    "id" UUID NOT NULL,
    "customerName" TEXT NOT NULL,
    "stampCount" INTEGER NOT NULL DEFAULT 0,
    "freeHourAvailable" BOOLEAN NOT NULL DEFAULT false,
    "snackKitAvailable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoyaltyRedemption" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "rewardType" "LoyaltyRewardType" NOT NULL,
    "stampsUsed" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoyaltyCard_customerName_idx" ON "LoyaltyCard"("customerName");
CREATE INDEX "LoyaltyRedemption_cardId_createdAt_idx" ON "LoyaltyRedemption"("cardId", "createdAt");
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
