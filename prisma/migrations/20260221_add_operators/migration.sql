-- CreateTable
CREATE TABLE IF NOT EXISTS "operators" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "nickname" TEXT NOT NULL,
    "addedBy" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "operators_telegramId_key" ON "operators"("telegramId");

-- AlterTable
ALTER TABLE "OrderBatch" ADD COLUMN IF NOT EXISTS "operatorId" INTEGER;

-- AddForeignKey
ALTER TABLE "OrderBatch" ADD CONSTRAINT "OrderBatch_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "operators"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
