-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `display_name` VARCHAR(120) NOT NULL DEFAULT '',
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(64) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,

    INDEX `sessions_user_id_idx`(`user_id`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `folders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `parent_id` INTEGER NULL,
    `description` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `folders_parent_id_name_idx`(`parent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_files` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `stored_filename` VARCHAR(128) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `file_extension` VARCHAR(16) NOT NULL,
    `media_type` ENUM('video', 'audio', 'image') NOT NULL,
    `file_size` BIGINT NOT NULL,
    `duration` DOUBLE NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `codec` VARCHAR(64) NULL,
    `audio_codec` VARCHAR(64) NULL,
    `frame_rate` DOUBLE NULL,
    `bit_rate` INTEGER NULL,
    `category` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `folder_id` INTEGER NULL,
    `original_path` VARCHAR(512) NOT NULL,
    `proxy_path` VARCHAR(512) NULL,
    `proxy_size` BIGINT NULL,
    `thumbnail_path` VARCHAR(512) NULL,
    `thumbnail_size` BIGINT NULL,
    `cloud_proxy_url` VARCHAR(1024) NULL,
    `checksum` CHAR(64) NOT NULL,
    `processing_status` ENUM('pending', 'processing', 'ready', 'failed') NOT NULL DEFAULT 'pending',
    `upload_status` ENUM('uploading', 'complete', 'failed') NOT NULL DEFAULT 'complete',
    `probe_data` JSON NULL,
    `uploaded_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `media_files_checksum_key`(`checksum`),
    INDEX `media_files_folder_id_created_at_idx`(`folder_id`, `created_at`),
    INDEX `media_files_media_type_created_at_idx`(`media_type`, `created_at`),
    INDEX `media_files_processing_status_idx`(`processing_status`),
    INDEX `media_files_category_idx`(`category`),
    INDEX `media_files_created_at_idx`(`created_at`),
    INDEX `media_files_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tags_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_tags` (
    `media_id` CHAR(36) NOT NULL,
    `tag_id` INTEGER NOT NULL,

    INDEX `media_tags_tag_id_idx`(`tag_id`),
    PRIMARY KEY (`media_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `processing_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `media_id` CHAR(36) NOT NULL,
    `job_type` ENUM('probe', 'thumbnail', 'proxy') NOT NULL,
    `status` ENUM('queued', 'running', 'completed', 'failed') NOT NULL DEFAULT 'queued',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `run_after` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `processing_jobs_status_run_after_id_idx`(`status`, `run_after`, `id`),
    INDEX `processing_jobs_media_id_idx`(`media_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `storage_locations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `media_id` CHAR(36) NOT NULL,
    `kind` ENUM('original', 'proxy', 'thumbnail') NOT NULL,
    `storage_type` ENUM('local_ssd', 'cloud') NOT NULL,
    `storage_path` VARCHAR(1024) NOT NULL,
    `status` ENUM('available', 'missing') NOT NULL DEFAULT 'available',
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `storage_locations_media_id_kind_storage_type_key`(`media_id`, `kind`, `storage_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `filename` VARCHAR(255) NOT NULL,
    `size_bytes` BIGINT NULL,
    `status` ENUM('running', 'succeeded', 'failed') NOT NULL DEFAULT 'running',
    `trigger` VARCHAR(32) NOT NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `backups_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_files` ADD CONSTRAINT `media_files_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_files` ADD CONSTRAINT `media_files_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_tags` ADD CONSTRAINT `media_tags_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `media_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_tags` ADD CONSTRAINT `media_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `processing_jobs` ADD CONSTRAINT `processing_jobs_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `media_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_locations` ADD CONSTRAINT `storage_locations_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `media_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
