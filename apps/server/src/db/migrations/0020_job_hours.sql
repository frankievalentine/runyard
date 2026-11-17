CREATE TABLE `job_hours` (
	`hour` integer PRIMARY KEY NOT NULL,
	`jobs` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL
);
