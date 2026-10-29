CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`forge_id` text NOT NULL,
	`repo` text NOT NULL,
	`job_id` integer,
	`run_id` integer NOT NULL,
	`run_attempt` integer NOT NULL,
	`name` text,
	`workflow` text,
	`runner_name` text,
	`machine_id` text,
	`pool_id` text,
	`started_at` integer,
	`finished_at` integer,
	`conclusion` text,
	`html_url` text,
	`test` integer DEFAULT false NOT NULL,
	`hook` text,
	`sources` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_job` ON `jobs` (`forge_id`,`repo`,`job_id`);--> statement-breakpoint
CREATE INDEX `jobs_run` ON `jobs` (`forge_id`,`repo`,`run_id`,`run_attempt`);--> statement-breakpoint
CREATE INDEX `jobs_machine` ON `jobs` (`machine_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `jobs_pool` ON `jobs` (`pool_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `jobs_updated` ON `jobs` (`updated_at`);