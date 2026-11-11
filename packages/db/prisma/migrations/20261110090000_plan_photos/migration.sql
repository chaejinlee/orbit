-- CreateTable
CREATE TABLE "plan_photos" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "thumbBytes" INTEGER NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_photos_planId_createdAt_idx" ON "plan_photos"("planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "plan_photos_uploadedById_clientRequestId_key" ON "plan_photos"("uploadedById", "clientRequestId");

-- AddForeignKey
ALTER TABLE "plan_photos" ADD CONSTRAINT "plan_photos_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_photos" ADD CONSTRAINT "plan_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
