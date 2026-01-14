/*
  Warnings:

  - A unique constraint covering the columns `[date,scaleId,kind,scaleFunctionId,slot]` on the table `DutyEvent` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[date,scaleId,kind,executorId]` on the table `DutyEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `DutyEvent_date_scaleFunctionId_slot_key` ON `dutyevent`;

-- CreateIndex
CREATE INDEX `DutyEvent_scaleFunctionId_date_idx` ON `DutyEvent`(`scaleFunctionId`, `date`);

-- CreateIndex
CREATE UNIQUE INDEX `DutyEvent_date_scaleId_kind_scaleFunctionId_slot_key` ON `DutyEvent`(`date`, `scaleId`, `kind`, `scaleFunctionId`, `slot`);

-- CreateIndex
CREATE UNIQUE INDEX `DutyEvent_date_scaleId_kind_executorId_key` ON `DutyEvent`(`date`, `scaleId`, `kind`, `executorId`);
