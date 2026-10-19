CREATE TABLE "SessionRateSegment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "stationType" "StationType" NOT NULL,
    "hourlyCents" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    CONSTRAINT "SessionRateSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionRateSegment_sessionId_startedAt_idx"
ON "SessionRateSegment"("sessionId", "startedAt");

ALTER TABLE "SessionRateSegment"
ADD CONSTRAINT "SessionRateSegment_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SessionRateSegment" ("id", "sessionId", "stationType", "hourlyCents", "startedAt", "endedAt")
SELECT gen_random_uuid(), s."id", st."type", s."hourlyCents", s."startedAt", s."finishedAt"
FROM "Session" s
JOIN "Station" st ON st."id" = s."stationId";
