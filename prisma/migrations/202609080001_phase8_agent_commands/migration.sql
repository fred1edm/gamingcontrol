CREATE TYPE "AgentCommandStatus" AS ENUM ('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED');

CREATE TABLE "AgentCommand" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "status" "AgentCommandStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(3),
    "acknowledgedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentCommand_stationId_status_createdAt_idx" ON "AgentCommand"("stationId", "status", "createdAt");
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
