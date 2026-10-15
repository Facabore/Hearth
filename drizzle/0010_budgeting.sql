CREATE TABLE "budget_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"value" bigint NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "budget_allocations_value_positive" CHECK ("budget_allocations"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_line_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"mapped_at" timestamp with time zone NOT NULL,
	"unmapped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"origin_line_id" uuid,
	"name" text NOT NULL,
	"planned_amount" bigint NOT NULL,
	"funding" text NOT NULL,
	"savings_account_ids" uuid[] NOT NULL,
	"rollover_mode" text NOT NULL,
	"is_catch_all" boolean NOT NULL,
	"allocation_rule" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budget_lines_planned_positive" CHECK ("budget_lines"."planned_amount" > 0),
	CONSTRAINT "budget_lines_savings_accounts" CHECK (("budget_lines"."funding" = 'SAVINGS') = (cardinality("budget_lines"."savings_account_ids") > 0)),
	CONSTRAINT "budget_lines_savings_catch_all" CHECK (NOT ("budget_lines"."funding" = 'SAVINGS' AND "budget_lines"."is_catch_all"))
);
--> statement-breakpoint
CREATE TABLE "budget_member_capacities" (
	"plan_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "budget_member_capacities_plan_id_member_id_pk" PRIMARY KEY("plan_id","member_id"),
	CONSTRAINT "budget_member_capacities_amount" CHECK ("budget_member_capacities"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text NOT NULL,
	"created_from_plan_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "budget_plans_dates" CHECK ("budget_plans"."start_date" <= "budget_plans"."end_date")
);
--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_member_id_space_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."space_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_categories" ADD CONSTRAINT "budget_line_categories_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_categories" ADD CONSTRAINT "budget_line_categories_line_id_budget_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_categories" ADD CONSTRAINT "budget_line_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_origin_line_id_budget_lines_id_fk" FOREIGN KEY ("origin_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_member_capacities" ADD CONSTRAINT "budget_member_capacities_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_member_capacities" ADD CONSTRAINT "budget_member_capacities_member_id_space_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."space_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_created_from_plan_id_budget_plans_id_fk" FOREIGN KEY ("created_from_plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocations_current_uq" ON "budget_allocations" USING btree ("line_id","member_id") WHERE "budget_allocations"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "budget_allocations_member_idx" ON "budget_allocations" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_line_categories_current_uq" ON "budget_line_categories" USING btree ("plan_id","category_id") WHERE "budget_line_categories"."unmapped_at" IS NULL;--> statement-breakpoint
CREATE INDEX "budget_line_categories_line_idx" ON "budget_line_categories" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "budget_line_categories_category_idx" ON "budget_line_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "budget_lines_plan_idx" ON "budget_lines" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "budget_lines_origin_idx" ON "budget_lines" USING btree ("origin_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_plan_name_uq" ON "budget_lines" USING btree ("plan_id",lower("name")) WHERE "budget_lines"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_catch_all_uq" ON "budget_lines" USING btree ("plan_id") WHERE "budget_lines"."is_catch_all" AND "budget_lines"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "budget_member_capacities_member_idx" ON "budget_member_capacities" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_plans_space_start_uq" ON "budget_plans" USING btree ("space_id","start_date");--> statement-breakpoint
CREATE INDEX "budget_plans_created_from_idx" ON "budget_plans" USING btree ("created_from_plan_id");