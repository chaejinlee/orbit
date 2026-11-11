-- Comments: idempotency key per author, so a retried or double-tapped Send
-- creates one comment.
ALTER TABLE "comments" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "comments_authorId_clientRequestId_key" ON "comments"("authorId", "clientRequestId");
