/*
  Warnings:

  - A unique constraint covering the columns `[date,scaleFunctionId,slot]` on the table `DutyEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `dutyevent` ADD COLUMN `scaleFunctionId` VARCHAR(191) NULL,
    ADD COLUMN `slot` INTEGER NULL;

-- CreateTable
CREATE TABLE `ScaleFunction` (
    `id` VARCHAR(191) NOT NULL,
    `scaleId` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScaleFunction_scaleId_idx`(`scaleId`),
    UNIQUE INDEX `ScaleFunction_scaleId_nome_key`(`scaleId`, `nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleFunctionRequirement` (
    `id` VARCHAR(191) NOT NULL,
    `scaleFunctionId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScaleFunctionRequirement_date_idx`(`date`),
    INDEX `ScaleFunctionRequirement_scaleFunctionId_date_idx`(`scaleFunctionId`, `date`),
    UNIQUE INDEX `ScaleFunctionRequirement_scaleFunctionId_date_key`(`scaleFunctionId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleFunctionOptOut` (
    `id` VARCHAR(191) NOT NULL,
    `scaleFunctionId` VARCHAR(191) NOT NULL,
    `militarId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScaleFunctionOptOut_militarId_idx`(`militarId`),
    UNIQUE INDEX `ScaleFunctionOptOut_scaleFunctionId_militarId_key`(`scaleFunctionId`, `militarId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `DutyEvent_scaleId_date_kind_idx` ON `DutyEvent`(`scaleId`, `date`, `kind`);

-- CreateIndex
CREATE UNIQUE INDEX `DutyEvent_date_scaleFunctionId_slot_key` ON `DutyEvent`(`date`, `scaleFunctionId`, `slot`);

-- AddForeignKey
ALTER TABLE `DutyEvent` ADD CONSTRAINT `DutyEvent_scaleFunctionId_fkey` FOREIGN KEY (`scaleFunctionId`) REFERENCES `ScaleFunction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleFunction` ADD CONSTRAINT `ScaleFunction_scaleId_fkey` FOREIGN KEY (`scaleId`) REFERENCES `Scale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleFunctionRequirement` ADD CONSTRAINT `ScaleFunctionRequirement_scaleFunctionId_fkey` FOREIGN KEY (`scaleFunctionId`) REFERENCES `ScaleFunction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleFunctionRequirement` ADD CONSTRAINT `ScaleFunctionRequirement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleFunctionOptOut` ADD CONSTRAINT `ScaleFunctionOptOut_scaleFunctionId_fkey` FOREIGN KEY (`scaleFunctionId`) REFERENCES `ScaleFunction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleFunctionOptOut` ADD CONSTRAINT `ScaleFunctionOptOut_militarId_fkey` FOREIGN KEY (`militarId`) REFERENCES `Militar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleFunctionOptOut` ADD CONSTRAINT `ScaleFunctionOptOut_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
