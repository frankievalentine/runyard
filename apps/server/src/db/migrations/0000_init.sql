CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`iv` blob NOT NULL,
	`ciphertext` blob NOT NULL,
	`updated_at` integer NOT NULL
);
