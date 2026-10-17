ALTER TABLE "user" ADD COLUMN "number_format" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "time_format" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "date_format" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "week_start" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_number_format" CHECK ("user"."number_format" IN ('DOT_COMMA', 'COMMA_DOT', 'SPACE_COMMA'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_time_format" CHECK ("user"."time_format" IN ('H24', 'H12'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_date_format" CHECK ("user"."date_format" IN ('DMY', 'MDY', 'YMD'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_week_start" CHECK ("user"."week_start" IN ('MONDAY', 'SUNDAY'));