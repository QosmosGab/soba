CREATE TYPE "public"."callback_outcome" AS ENUM('confirmed', 'declined', 'no_answer', 'changed', 'pending');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('call', 'text');--> statement-breakpoint
CREATE TYPE "public"."decision_action" AS ENUM('approve', 'counter', 'reject', 'take_over', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."fulfillment" AS ENUM('collect', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."line_kind" AS ENUM('voice', 'text');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('voice', 'sms', 'whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."party" AS ENUM('buyer', 'rep', 'desk');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('auto_cleared', 'approved', 'in_progress', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('new_order', 'availability', 'hold', 'change', 'complaint', 'pickup', 'other');--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"company" text,
	"city" text,
	"contactName" text,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usualPickup" text,
	"firstSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"doNotContact" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requestId" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"outcome" "callback_outcome" DEFAULT 'pending' NOT NULL,
	"buyerYesAt" timestamp with time zone,
	"lastAttemptAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coverage" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start" text DEFAULT '00:00' NOT NULL,
	"end" text DEFAULT '23:59' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Phoenix' NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"plan" text DEFAULT 'pilot' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requestId" uuid NOT NULL,
	"memberId" uuid,
	"action" "decision_action" NOT NULL,
	"quantity" integer,
	"counterPrice" numeric(10, 2),
	"reason" text,
	"undoDeadline" timestamp with time zone,
	"undone" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"customerId" uuid,
	"requestId" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"kind" "line_kind" NOT NULL,
	"companyNumber" text,
	"twilioNumber" text NOT NULL,
	"callerIdVerified" boolean DEFAULT false NOT NULL,
	"textRegistrationStatus" text,
	"lastForwardingTestAt" timestamp with time zone,
	"lastForwardingTestOk" boolean,
	"backupNumber" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requestId" uuid,
	"customerId" uuid NOT NULL,
	"direction" text NOT NULL,
	"party" "party" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"body" text,
	"buttonPayload" text,
	"providerId" text,
	"sentAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deliveredAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requestId" uuid NOT NULL,
	"product" text NOT NULL,
	"size" text,
	"pack" text,
	"cases" integer,
	"priceOffered" numeric(10, 2),
	"finalPrice" numeric(10, 2),
	"pickupDate" text,
	"fulfillment" "fulfillment",
	"destination" text,
	"poNumber" text,
	"notOnSheet" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"sheetId" uuid,
	"product" text NOT NULL,
	"size" text,
	"pack" text,
	"minPrice" numeric(10, 2) NOT NULL,
	"caseLimit" integer NOT NULL,
	"casesCleared" integer DEFAULT 0 NOT NULL,
	"on" boolean DEFAULT true NOT NULL,
	"liveFrom" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"groupKey" text,
	"spread" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "price_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"fileUrl" text,
	"receivedVia" text NOT NULL,
	"parsedAt" timestamp with time zone,
	"confirmedById" uuid,
	"confirmedAt" timestamp with time zone,
	"rawText" text
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"ref" integer NOT NULL,
	"channel" "channel" NOT NULL,
	"buyerId" uuid,
	"callerName" text,
	"callerCompany" text,
	"callbackNumber" text,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "request_type" NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "request_status" DEFAULT 'in_progress' NOT NULL,
	"summary" text,
	"claimedById" uuid,
	"decidedById" uuid,
	"takeOverOutcome" text,
	"assisted" boolean DEFAULT false NOT NULL,
	"callbackPermission" boolean,
	"transcriptUrl" text,
	"providerConversationId" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"customerId" uuid PRIMARY KEY NOT NULL,
	"hours" jsonb NOT NULL,
	"holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ringCount" integer DEFAULT 4 NOT NULL,
	"daytimeOverflow" boolean DEFAULT false NOT NULL,
	"answering" boolean DEFAULT true NOT NULL,
	"autoClear" boolean DEFAULT true NOT NULL,
	"greeting" text NOT NULL,
	"voice" text DEFAULT 'default' NOT NULL,
	"spanish" boolean DEFAULT true NOT NULL,
	"quotePrices" boolean DEFAULT true NOT NULL,
	"timingPromises" boolean DEFAULT false NOT NULL,
	"businessInfo" text DEFAULT '' NOT NULL,
	"undoSeconds" integer DEFAULT 120 NOT NULL,
	"noAnswerAction" text DEFAULT 'text' NOT NULL,
	"confirmationTemplate" text DEFAULT '{company}: confirmed {cases} cases {product} at ${price}, pickup {pickup}. Ref {ref}. Your order will be entered in our system this morning. Reply here to change.' NOT NULL,
	"summaryMinutesBefore" integer DEFAULT 15 NOT NULL,
	"summarySections" jsonb DEFAULT '["orders","rules","other","transcripts"]'::jsonb NOT NULL,
	"quietNightNote" boolean DEFAULT true NOT NULL,
	"summaryLanguage" text DEFAULT 'en' NOT NULL,
	"retentionMonths" integer DEFAULT 12 NOT NULL,
	"implausiblePricePct" integer DEFAULT 30 NOT NULL,
	"everyoneGetsCards" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"windowEnd" timestamp with time zone NOT NULL,
	"sentAt" timestamp with time zone,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enteredFlags" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customerId" uuid NOT NULL,
	"name" text NOT NULL,
	"cell" text NOT NULL,
	"whatsappOptedIn" boolean DEFAULT false NOT NULL,
	"email" text,
	"canSetPrices" boolean DEFAULT false NOT NULL,
	"canApprove" boolean DEFAULT true NOT NULL,
	"canEditSettings" boolean DEFAULT false NOT NULL,
	"isOrderClerk" boolean DEFAULT false NOT NULL,
	"isOnCall" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage" ADD CONSTRAINT "coverage_memberId_team_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_memberId_team_members_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_requestId_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_sheetId_price_sheets_id_fk" FOREIGN KEY ("sheetId") REFERENCES "public"."price_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD CONSTRAINT "price_sheets_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_sheets" ADD CONSTRAINT "price_sheets_confirmedById_team_members_id_fk" FOREIGN KEY ("confirmedById") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_buyerId_buyers_id_fk" FOREIGN KEY ("buyerId") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_claimedById_team_members_id_fk" FOREIGN KEY ("claimedById") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_decidedById_team_members_id_fk" FOREIGN KEY ("decidedById") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyers_customer" ON "buyers" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "events_request" ON "events" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "events_customer_at" ON "events" USING btree ("customerId","at");--> statement-breakpoint
CREATE UNIQUE INDEX "lines_twilio_number" ON "lines" USING btree ("twilioNumber");--> statement-breakpoint
CREATE INDEX "messages_request" ON "messages" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "price_rules_customer_live" ON "price_rules" USING btree ("customerId","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_customer_ref" ON "requests" USING btree ("customerId","ref");--> statement-breakpoint
CREATE INDEX "requests_customer_received" ON "requests" USING btree ("customerId","receivedAt");--> statement-breakpoint
CREATE INDEX "team_members_customer" ON "team_members" USING btree ("customerId");