CREATE TABLE `forgejo_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`login` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `pools` ADD `forgejo_mode` text DEFAULT 'host' NOT NULL;--> statement-breakpoint
ALTER TABLE `pools` ADD `forgejo_image` text;--> statement-breakpoint
ALTER TABLE `registrations` ADD `runner_kind` text DEFAULT 'actions' NOT NULL;