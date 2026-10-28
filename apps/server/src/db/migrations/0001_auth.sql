CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text,
	`password_hash` text,
	`tailscale_login` text,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "users_has_identity" CHECK("users"."username" IS NOT NULL OR "users"."tailscale_login" IS NOT NULL),
	CONSTRAINT "users_password_with_username" CHECK(("users"."username" IS NULL) = ("users"."password_hash" IS NULL)),
	CONSTRAINT "users_role" CHECK("users"."role" IN ('admin', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_tailscaleLogin_unique` ON `users` (`tailscale_login`);