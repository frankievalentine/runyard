CREATE TABLE `github_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text NOT NULL,
	`owner` text NOT NULL,
	`owner_type` text NOT NULL,
	`html_url` text NOT NULL,
	`api_base` text NOT NULL,
	`created_at` integer NOT NULL
);
