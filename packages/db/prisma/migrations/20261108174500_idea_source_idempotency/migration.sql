-- AlterTable
ALTER TABLE "idea_sources" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "idea_sources_planId_clientRequestId_key" ON "idea_sources"("planId", "clientRequestId");

