-- AlterTable
ALTER TABLE `users` ADD COLUMN `avatar_url` VARCHAR(1024) NULL,
    ADD COLUMN `email` VARCHAR(255) NULL,
    ADD COLUMN `firebase_uid` VARCHAR(128) NULL,
    MODIFY `password_hash` VARCHAR(255) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);

-- CreateIndex
CREATE UNIQUE INDEX `users_firebase_uid_key` ON `users`(`firebase_uid`);

