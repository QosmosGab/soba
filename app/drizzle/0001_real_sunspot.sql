CREATE TABLE "buyer_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"lineId" uuid,
	"buyerPhone" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"requestId" uuid,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rep_threads" (
	"memberId" uuid PRIMARY KEY NOT NULL,
	"requestId" uuid,
	"state" text DEFAULT 'idle' NOT NULL,
	"pendingSheetId" uuid,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callbacks" ADD COLUMN "decisionId" uuid;--> statement-breakpoint
ALTER TABLE "callbacks" ADD COLUMN "offerCases" integer;--> statement-breakpoint
ALTER TABLE "callbacks" ADD COLUMN "offerPrice" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "callbacks" ADD COLUMN "providerConversationId" text;--> statement-breakpoint
ALTER TABLE "callbacks" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "panelToken" text;--> statement-breakpoint
ALTER TABLE "lines" ADD COLUMN "elevenAgentId" text;--> statement-breakpoint
ALTER TABLE "lines" ADD COLUMN "elevenPhoneNumberId" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "threadId" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "memberId" uuid;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD COLUMN "parsed" jsonb;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD COLUMN "question" text;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD COLUMN "sentById" uuid;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD COLUMN "createdAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "isTest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "enteredAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "samePricesPromptTime" text DEFAULT '17:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "escalationMinutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "blockedNumbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "testNumbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "urgentRing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "textFirstBeforeCall" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "isOwner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "summaryWhatsapp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "summaryEmail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "buyer_threads" ADD CONSTRAINT "buyer_threads_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_threads" ADD CONSTRAINT "buyer_threads_lineId_lines_id_fk" FOREIGN KEY ("lineId") REFERENCES "public"."lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_threads" ADD CONSTRAINT "buyer_threads_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_threads" ADD CONSTRAINT "rep_threads_memberId_team_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_threads" ADD CONSTRAINT "rep_threads_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_threads_lookup" ON "buyer_threads" USING btree ("customerId","buyerPhone","state");--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_decisionId_decisions_id_fk" FOREIGN KEY ("decisionId") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD CONSTRAINT "price_sheets_sentById_team_members_id_fk" FOREIGN KEY ("sentById") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread" ON "messages" USING btree ("threadId");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider" ON "messages" USING btree ("providerId");--> statement-breakpoint
CREATE INDEX "team_members_cell" ON "team_members" USING btree ("cell");