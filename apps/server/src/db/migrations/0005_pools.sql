CREATE TABLE `pool_machines` (
	`pool_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`slots` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pool_machines_slots" CHECK("pool_machines"."slots" BETWEEN 1 AND 16)
);
--> statement-breakpoint
CREATE INDEX `pool_machines_pool` ON `pool_machines` (`pool_id`);--> statement-breakpoint
CREATE TABLE `pool_scopes` (
	`pool_id` text NOT NULL,
	`forge_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pool_scopes_pool` ON `pool_scopes` (`pool_id`);--> statement-breakpoint
CREATE TABLE `pools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`labels` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pools_name_unique` ON `pools` (`name`);--> statement-breakpoint
CREATE TABLE `public_repo_overrides` (
	`forge_id` text NOT NULL,
	`repo` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_repo_overrides_repo` ON `public_repo_overrides` (`forge_id`,`repo`);--> statement-breakpoint
CREATE TABLE `registrations` (
	`key` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`runner_name` text NOT NULL,
	`forge_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_target` text NOT NULL,
	`path` text NOT NULL,
	`service_mode` text NOT NULL,
	`created_at` integer NOT NULL
);
