-- AlterTable
ALTER TABLE `processing_jobs` MODIFY `job_type` ENUM('probe', 'thumbnail', 'proxy', 'analyze') NOT NULL;

-- CreateTable
CREATE TABLE `media_analyses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `media_id` CHAR(36) NOT NULL,
    `model` VARCHAR(64) NOT NULL,
    `pipeline_version` INTEGER NOT NULL,
    `summary` TEXT NOT NULL,
    `suggested_title` VARCHAR(255) NULL,
    `setting` VARCHAR(120) NULL,
    `indoor_outdoor` VARCHAR(16) NULL,
    `language` VARCHAR(40) NULL,
    `has_speech` BOOLEAN NOT NULL DEFAULT false,
    `has_music` BOOLEAN NOT NULL DEFAULT false,
    `people_count` INTEGER NULL,
    `tags` JSON NOT NULL,
    `people` JSON NOT NULL,
    `topics` JSON NOT NULL,
    `search_text` MEDIUMTEXT NOT NULL,
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `elapsed_ms` INTEGER NOT NULL DEFAULT 0,
    `raw_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `media_analyses_media_id_key`(`media_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_segments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `analysis_id` INTEGER NOT NULL,
    `media_id` CHAR(36) NOT NULL,
    `start_ms` INTEGER NOT NULL,
    `end_ms` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `shot_type` VARCHAR(40) NULL,
    `camera_movement` VARCHAR(40) NULL,
    `setting` VARCHAR(120) NULL,
    `search_text` TEXT NOT NULL,

    INDEX `video_segments_media_id_start_ms_idx`(`media_id`, `start_ms`),
    INDEX `video_segments_analysis_id_idx`(`analysis_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analysis_attributes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `analysis_id` INTEGER NOT NULL,
    `media_id` CHAR(36) NOT NULL,
    `segment_id` INTEGER NULL,
    `category` VARCHAR(24) NOT NULL,
    `value` VARCHAR(120) NOT NULL,
    `color` VARCHAR(40) NULL,
    `pattern` VARCHAR(40) NULL,
    `body_region` VARCHAR(16) NULL,
    `person_label` VARCHAR(40) NULL,
    `start_ms` INTEGER NOT NULL,
    `end_ms` INTEGER NOT NULL,
    `confidence` DOUBLE NULL,
    `source` VARCHAR(24) NOT NULL DEFAULT 'gemini',
    `model_version` VARCHAR(64) NOT NULL,

    INDEX `analysis_attributes_category_value_idx`(`category`, `value`),
    INDEX `analysis_attributes_media_id_category_idx`(`media_id`, `category`),
    INDEX `analysis_attributes_analysis_id_idx`(`analysis_id`),
    INDEX `analysis_attributes_segment_id_idx`(`segment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcript_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `analysis_id` INTEGER NOT NULL,
    `media_id` CHAR(36) NOT NULL,
    `start_ms` INTEGER NOT NULL,
    `end_ms` INTEGER NOT NULL,
    `speaker` VARCHAR(40) NULL,
    `text` TEXT NOT NULL,

    INDEX `transcript_lines_media_id_start_ms_idx`(`media_id`, `start_ms`),
    INDEX `transcript_lines_analysis_id_idx`(`analysis_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `media_analyses` ADD CONSTRAINT `media_analyses_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `media_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_segments` ADD CONSTRAINT `video_segments_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `media_analyses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `analysis_attributes` ADD CONSTRAINT `analysis_attributes_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `media_analyses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `analysis_attributes` ADD CONSTRAINT `analysis_attributes_segment_id_fkey` FOREIGN KEY (`segment_id`) REFERENCES `video_segments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcript_lines` ADD CONSTRAINT `transcript_lines_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `media_analyses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

