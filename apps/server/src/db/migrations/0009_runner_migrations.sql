CREATE TABLE `runner_migrations` (
	`forge_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_target` text NOT NULL,
	`runner_name` text NOT NULL,
	`machine_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`path` text,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	PRIMARY KEY(`forge_id`, `scope_kind`, `scope_target`, `runner_name`),
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE cascade
);
