CREATE TABLE `dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`runner_name` text NOT NULL,
	`runner_kind` text NOT NULL,
	`forge_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_target` text NOT NULL,
	`job_id` integer NOT NULL,
	`runner_id` integer,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`detail` text,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatches_job` ON `dispatches` (`job_id`);--> statement-breakpoint
CREATE INDEX `dispatches_started` ON `dispatches` (`started_at`);--> statement-breakpoint
CREATE TABLE `runner_templates` (
	`key` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`pool_name` text NOT NULL,
	`forge_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_target` text NOT NULL,
	`runner_kind` text NOT NULL,
	`path` text NOT NULL,
	`service_mode` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pools` ADD `mode` text DEFAULT 'persistent' NOT NULL;--> statement-breakpoint
ALTER TABLE `pools` ADD `paused` integer DEFAULT false NOT NULL;