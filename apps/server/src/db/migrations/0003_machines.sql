CREATE TABLE `ignored_peers` (
	`node_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ignored_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `machine_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`machine_id` text NOT NULL,
	`machine_name` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `machine_events_machine` ON `machine_events` (`machine_id`,`id`);--> statement-breakpoint
CREATE INDEX `machine_events_at` ON `machine_events` (`at`);--> statement-breakpoint
CREATE TABLE `machine_states` (
	`machine_id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ssh_target` text NOT NULL,
	`transport` text NOT NULL,
	`expected_os` text,
	`tailscale_node_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "machines_transport" CHECK("machines"."transport" IN ('openssh', 'tailscale'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machines_tailscaleNodeId_unique` ON `machines` (`tailscale_node_id`);