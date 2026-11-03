// Soba data model. Mirrors "Data model" in the MVP product spec (2 Nov 2026).
// Every request keeps its full event history so the panel, the morning summary
// and the metrics all read from the same log.
import {
  pgTable, pgEnum, text, integer, boolean, timestamp, numeric, jsonb, uuid, index, uniqueIndex, serial,
} from "drizzle-orm/pg-core";

export const requestStatus = pgEnum("request_status", ["auto_cleared", "approved", "in_progress", "rejected"]);
export const requestType = pgEnum("request_type", [
  "new_order", "availability", "hold", "change", "complaint", "pickup", "other",
]);
export const channel = pgEnum("channel", ["call", "text"]);
export const lineKind = pgEnum("line_kind", ["voice", "text"]);
export const partyKind = pgEnum("party", ["buyer", "rep", "desk"]);
export const messageChannel = pgEnum("message_channel", ["voice", "sms", "whatsapp", "email"]);
export const decisionAction = pgEnum("decision_action", ["approve", "counter", "reject", "take_over", "won", "lost"]);
export const callbackOutcome = pgEnum("callback_outcome", ["confirmed", "declined", "no_answer", "changed", "pending"]);
export const fulfillment = pgEnum("fulfillment", ["collect", "delivered"]);

const ts = () => timestamp({ withTimezone: true });

export const customers = pgTable("customers", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),               // name the desk uses on calls, e.g. "Del Campo Supreme"
  timezone: text().notNull().default("America/Phoenix"),
  status: text().notNull().default("setup"), // setup | live | paused
  plan: text().notNull().default("pilot"),
  panelToken: text(),                  // secret in the panel login link
  createdAt: ts().notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  customerId: uuid().primaryKey().references(() => customers.id, { onDelete: "cascade" }),
  // hours: { mon: {open:"06:00", close:"17:00", closed:false}, ... }
  hours: jsonb().$type<Record<string, { open: string; close: string; closed: boolean }>>().notNull(),
  holidays: jsonb().$type<string[]>().notNull().default([]),
  ringCount: integer().notNull().default(4),
  daytimeOverflow: boolean().notNull().default(false),
  answering: boolean().notNull().default(true),
  autoClear: boolean().notNull().default(true),
  greeting: text().notNull(),
  voice: text().notNull().default("default"),
  spanish: boolean().notNull().default(true),
  quotePrices: boolean().notNull().default(true),
  timingPromises: boolean().notNull().default(false),
  businessInfo: text().notNull().default(""),   // pickup address, hours, terms the desk may share
  undoSeconds: integer().notNull().default(120),
  noAnswerAction: text().notNull().default("text"), // text | whatsapp | none
  confirmationTemplate: text().notNull().default(
    "{company}: confirmed {cases} cases {product} at ${price}, pickup {pickup}. Ref {ref}. Your order will be entered in our system this morning. Reply here to change."),
  summaryMinutesBefore: integer().notNull().default(15),
  summarySections: jsonb().$type<string[]>().notNull().default(["orders", "rules", "other", "transcripts"]),
  quietNightNote: boolean().notNull().default(true),
  summaryLanguage: text().notNull().default("en"),
  retentionMonths: integer().notNull().default(12),
  implausiblePricePct: integer().notNull().default(30),
  everyoneGetsCards: boolean().notNull().default(false),
  samePricesPromptTime: text().notNull().default("17:30"), // local HH:MM, nightly "same prices as last night?"
  escalationMinutes: integer().notNull().default(10),      // no reply on a card → next rep
  blockedNumbers: jsonb().$type<string[]>().notNull().default([]),
  testNumbers: jsonb().$type<string[]>().notNull().default([]),
  urgentRing: boolean().notNull().default(true),
  textFirstBeforeCall: boolean().notNull().default(false), // "Del Campo calling you back…" text before the callback
});

export const lines = pgTable("lines", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  kind: lineKind().notNull(),
  companyNumber: text(),            // the customer's own number (forwarded line, or caller ID)
  twilioNumber: text().notNull(),   // our number
  callerIdVerified: boolean().notNull().default(false),
  textRegistrationStatus: text(),   // toll-free verification / 10DLC status
  lastForwardingTestAt: ts(),
  lastForwardingTestOk: boolean(),
  backupNumber: text(),
  elevenAgentId: text(),            // ElevenLabs agent that answers this line
  elevenPhoneNumberId: text(),      // ElevenLabs phone number id (Twilio import) for outbound callbacks
}, (t) => [uniqueIndex("lines_twilio_number").on(t.twilioNumber)]);

export const teamMembers = pgTable("team_members", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  name: text().notNull(),
  cell: text().notNull(),                 // E.164
  whatsappOptedIn: boolean().notNull().default(false),
  email: text(),
  canSetPrices: boolean().notNull().default(false),
  canApprove: boolean().notNull().default(true),
  canEditSettings: boolean().notNull().default(false),
  isOrderClerk: boolean().notNull().default(false),
  isOnCall: boolean().notNull().default(false),
  isOwner: boolean().notNull().default(false),        // default owner at opening
  summaryWhatsapp: boolean().notNull().default(true),
  summaryEmail: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
}, (t) => [index("team_members_customer").on(t.customerId), index("team_members_cell").on(t.cell)]);

/** Where each rep's WhatsApp thread with the desk stands: which card is live and what we last asked. */
export const repThreads = pgTable("rep_threads", {
  memberId: uuid().primaryKey().references(() => teamMembers.id, { onDelete: "cascade" }),
  requestId: uuid().references(() => requests.id, { onDelete: "set null" }),
  state: text().notNull().default("idle"), // idle | awaiting_counter | awaiting_reason | awaiting_clarify | awaiting_sheet_ok | awaiting_same_prices
  pendingSheetId: uuid(),
  updatedAt: ts().notNull().defaultNow(),
});

/** A buyer's text conversation on the business text line, until it becomes a request. */
export const buyerThreads = pgTable("buyer_threads", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  lineId: uuid().references(() => lines.id),
  buyerPhone: text().notNull(),
  state: text().notNull().default("open"), // open | done
  requestId: uuid().references(() => requests.id, { onDelete: "set null" }),
  startedAt: ts().notNull().defaultNow(),
  lastAt: ts().notNull().defaultNow(),
}, (t) => [index("buyer_threads_lookup").on(t.customerId, t.buyerPhone, t.state)]);

export const coverage = pgTable("coverage", {
  id: serial().primaryKey(),
  memberId: uuid().notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
  weekday: integer().notNull(),           // 0 = Monday … 6 = Sunday
  start: text().notNull().default("00:00"),
  end: text().notNull().default("23:59"),
});

export const buyers = pgTable("buyers", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  company: text(),
  city: text(),
  contactName: text(),
  phones: jsonb().$type<string[]>().notNull().default([]),
  emails: jsonb().$type<string[]>().notNull().default([]),
  usualPickup: text(),
  firstSeenAt: ts().notNull().defaultNow(),
  doNotContact: boolean().notNull().default(false),
}, (t) => [index("buyers_customer").on(t.customerId)]);

export const priceSheets = pgTable("price_sheets", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  fileUrl: text(),
  receivedVia: text().notNull(),           // whatsapp | upload | command
  parsedAt: ts(),
  confirmedById: uuid().references(() => teamMembers.id),
  confirmedAt: ts(),
  rawText: text(),
  parsed: jsonb().$type<Array<{ product: string; size: string | null; pack: string | null; minPrice: number; caseLimit: number; note?: string }>>(),
  question: text(),                        // the one clarifying question, if the sheet was unclear
  sentById: uuid().references(() => teamMembers.id),
  createdAt: ts().notNull().defaultNow(),
});

export const priceRules = pgTable("price_rules", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  sheetId: uuid().references(() => priceSheets.id),
  product: text().notNull(),
  size: text(),
  pack: text(),
  minPrice: numeric({ precision: 10, scale: 2 }).notNull(),
  caseLimit: integer().notNull(),
  casesCleared: integer().notNull().default(0),
  on: boolean().notNull().default(true),
  liveFrom: ts().notNull().defaultNow(),
  expiresAt: ts().notNull(),
  groupKey: text(),
  spread: numeric({ precision: 10, scale: 2 }),
}, (t) => [index("price_rules_customer_live").on(t.customerId, t.expiresAt)]);

export const requests = pgTable("requests", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  ref: integer().notNull(),                // per-customer human reference, e.g. 1047
  channel: channel().notNull(),
  buyerId: uuid().references(() => buyers.id),
  callerName: text(),
  callerCompany: text(),
  callbackNumber: text(),
  receivedAt: ts().notNull().defaultNow(),
  type: requestType().notNull(),
  flags: jsonb().$type<string[]>().notNull().default([]), // incomplete, unclear, not_on_sheet, wants_quote, repeat_caller, urgent
  status: requestStatus().notNull().default("in_progress"),
  summary: text(),                         // one-line summary for non-order types
  claimedById: uuid().references(() => teamMembers.id),
  decidedById: uuid().references(() => teamMembers.id),
  takeOverOutcome: text(),                 // won | lost
  assisted: boolean().notNull().default(false),
  callbackPermission: boolean(),
  transcriptUrl: text(),
  providerConversationId: text(),
  transcript: text(),                      // call notes or the text thread, plain text
  isTest: boolean().notNull().default(false),
  enteredAt: ts(),                         // rep marked the order entered in the ERP
}, (t) => [uniqueIndex("requests_customer_ref").on(t.customerId, t.ref), index("requests_customer_received").on(t.customerId, t.receivedAt)]);

export const orderLines = pgTable("order_lines", {
  id: uuid().primaryKey().defaultRandom(),
  requestId: uuid().notNull().references(() => requests.id, { onDelete: "cascade" }),
  product: text().notNull(),
  size: text(),
  pack: text(),
  cases: integer(),
  priceOffered: numeric({ precision: 10, scale: 2 }),
  finalPrice: numeric({ precision: 10, scale: 2 }),
  pickupDate: text(),                      // ISO date, resolved from "Monday"
  fulfillment: fulfillment(),
  destination: text(),
  poNumber: text(),
  notOnSheet: boolean().notNull().default(false),
});

export const messages = pgTable("messages", {
  id: uuid().primaryKey().defaultRandom(),
  requestId: uuid().references(() => requests.id, { onDelete: "cascade" }),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  direction: text().notNull(),             // in | out
  party: partyKind().notNull(),
  channel: messageChannel().notNull(),
  body: text(),
  buttonPayload: text(),
  providerId: text(),
  threadId: uuid(),                        // buyer_threads.id for text intake
  memberId: uuid(),                        // the rep, when party = rep
  sentAt: ts().notNull().defaultNow(),
  deliveredAt: ts(),
}, (t) => [index("messages_request").on(t.requestId), index("messages_thread").on(t.threadId), uniqueIndex("messages_provider").on(t.providerId)]);

export const decisions = pgTable("decisions", {
  id: uuid().primaryKey().defaultRandom(),
  requestId: uuid().notNull().references(() => requests.id, { onDelete: "cascade" }),
  memberId: uuid().references(() => teamMembers.id),
  action: decisionAction().notNull(),
  quantity: integer(),
  counterPrice: numeric({ precision: 10, scale: 2 }),
  reason: text(),
  undoDeadline: ts(),
  undone: boolean().notNull().default(false),
  createdAt: ts().notNull().defaultNow(),
});

export const callbacks = pgTable("callbacks", {
  id: uuid().primaryKey().defaultRandom(),
  requestId: uuid().notNull().references(() => requests.id, { onDelete: "cascade" }),
  channel: messageChannel().notNull(),
  attempts: integer().notNull().default(0),
  outcome: callbackOutcome().notNull().default("pending"),
  buyerYesAt: ts(),
  lastAttemptAt: ts(),
  decisionId: uuid().references(() => decisions.id),
  offerCases: integer(),
  offerPrice: numeric({ precision: 10, scale: 2 }),
  providerConversationId: text(),
  notes: text(),
});

export const summaries = pgTable("summaries", {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid().notNull().references(() => customers.id, { onDelete: "cascade" }),
  windowStart: ts().notNull(),
  windowEnd: ts().notNull(),
  sentAt: ts(),
  recipients: jsonb().$type<string[]>().notNull().default([]),
  enteredFlags: jsonb().$type<Record<string, boolean>>().notNull().default({}),
});

export const events = pgTable("events", {
  id: serial().primaryKey(),
  customerId: uuid().references(() => customers.id, { onDelete: "cascade" }),
  requestId: uuid().references(() => requests.id, { onDelete: "cascade" }),
  type: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  at: ts().notNull().defaultNow(),
}, (t) => [index("events_request").on(t.requestId), index("events_customer_at").on(t.customerId, t.at)]);
