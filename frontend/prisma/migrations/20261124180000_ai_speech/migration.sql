-- AlterTable
ALTER TABLE `media_analyses` ADD COLUMN `speech_summary` TEXT NULL,
    ADD COLUMN `speech_type` VARCHAR(32) NULL,
    ADD COLUMN `spoken_topics` JSON NULL;

