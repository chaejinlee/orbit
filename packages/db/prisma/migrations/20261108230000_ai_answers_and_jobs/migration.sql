-- AlterTable
ALTER TABLE "ai_responses" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "preset" TEXT,
ADD COLUMN     "usage" JSONB;

-- AlterTable
ALTER TABLE "planning_jobs" ADD COLUMN     "model" TEXT;

-- CreateIndex
CREATE INDEX "ai_responses_requestedById_createdAt_idx" ON "ai_responses"("requestedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_responses_requestedById_clientRequestId_key" ON "ai_responses"("requestedById", "clientRequestId");

-- CreateIndex
CREATE INDEX "planning_jobs_requestedById_createdAt_idx" ON "planning_jobs"("requestedById", "createdAt");

