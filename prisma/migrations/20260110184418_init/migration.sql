-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'OPERADOR', 'CONSULTA') NOT NULL DEFAULT 'OPERADOR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Militar` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `postoGrad` VARCHAR(191) NULL,
    `antiguidade` INTEGER NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Scale` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScaleMember` (
    `id` VARCHAR(191) NOT NULL,
    `scaleId` VARCHAR(191) NOT NULL,
    `militarId` VARCHAR(191) NOT NULL,
    `competitionMode` ENUM('AMBAS', 'SOMENTE_PRETA', 'SOMENTE_VERMELHA', 'NENHUMA') NOT NULL DEFAULT 'AMBAS',
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `ScaleMember_scaleId_idx`(`scaleId`),
    INDEX `ScaleMember_militarId_idx`(`militarId`),
    UNIQUE INDEX `ScaleMember_scaleId_militarId_key`(`scaleId`, `militarId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Restriction` (
    `id` VARCHAR(191) NOT NULL,
    `militarId` VARCHAR(191) NOT NULL,
    `scaleId` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `indefinite` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Restriction_militarId_idx`(`militarId`),
    INDEX `Restriction_scaleId_idx`(`scaleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarDay` (
    `date` DATETIME(3) NOT NULL,
    `dayType` ENUM('PRETA', 'VERMELHA') NOT NULL,
    `label` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UpperFunction` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UpperAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `upperFunctionId` VARCHAR(191) NOT NULL,
    `militarId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UpperAssignment_date_idx`(`date`),
    INDEX `UpperAssignment_militarId_idx`(`militarId`),
    UNIQUE INDEX `UpperAssignment_date_upperFunctionId_key`(`date`, `upperFunctionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DutyEvent` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `scaleId` VARCHAR(191) NULL,
    `kind` ENUM('BAIXO', 'CIMA') NOT NULL,
    `origin` ENUM('AUTO', 'MANUAL', 'SWAP') NOT NULL,
    `dayType` ENUM('PRETA', 'VERMELHA') NOT NULL,
    `titularId` VARCHAR(191) NULL,
    `executorId` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DutyEvent_date_idx`(`date`),
    INDEX `DutyEvent_scaleId_date_idx`(`scaleId`, `date`),
    INDEX `DutyEvent_executorId_date_idx`(`executorId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EngineConfig` (
    `id` VARCHAR(191) NOT NULL,
    `minRestDays` INTEGER NOT NULL DEFAULT 2,
    `allowOneDayRest` BOOLEAN NOT NULL DEFAULT true,
    `recalcHorizonDays` INTEGER NOT NULL DEFAULT 120,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `metaJson` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ScaleMember` ADD CONSTRAINT `ScaleMember_scaleId_fkey` FOREIGN KEY (`scaleId`) REFERENCES `Scale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScaleMember` ADD CONSTRAINT `ScaleMember_militarId_fkey` FOREIGN KEY (`militarId`) REFERENCES `Militar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Restriction` ADD CONSTRAINT `Restriction_militarId_fkey` FOREIGN KEY (`militarId`) REFERENCES `Militar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Restriction` ADD CONSTRAINT `Restriction_scaleId_fkey` FOREIGN KEY (`scaleId`) REFERENCES `Scale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UpperAssignment` ADD CONSTRAINT `UpperAssignment_upperFunctionId_fkey` FOREIGN KEY (`upperFunctionId`) REFERENCES `UpperFunction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UpperAssignment` ADD CONSTRAINT `UpperAssignment_militarId_fkey` FOREIGN KEY (`militarId`) REFERENCES `Militar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UpperAssignment` ADD CONSTRAINT `UpperAssignment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DutyEvent` ADD CONSTRAINT `DutyEvent_scaleId_fkey` FOREIGN KEY (`scaleId`) REFERENCES `Scale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DutyEvent` ADD CONSTRAINT `DutyEvent_titularId_fkey` FOREIGN KEY (`titularId`) REFERENCES `Militar`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DutyEvent` ADD CONSTRAINT `DutyEvent_executorId_fkey` FOREIGN KEY (`executorId`) REFERENCES `Militar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DutyEvent` ADD CONSTRAINT `DutyEvent_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
