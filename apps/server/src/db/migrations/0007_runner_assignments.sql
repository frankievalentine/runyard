CREATE TABLE `runner_assignments` (
	`forge_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_target` text NOT NULL,
	`runner_name` text NOT NULL,
	`machine_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`assigned_at` integer NOT NULL,
	PRIMARY KEY(`forge_id`, `scope_kind`, `scope_target`, `runner_name`),
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade
);
