// Every secret and external id Soba needs, read once. Missing values throw at
// first use, not at import, so tests and the panel run without the providers.
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  get appUrl() { return process.env.APP_URL ?? "http://localhost:3000"; },
  twilio: {
    get accountSid() { return need("TWILIO_ACCOUNT_SID"); },
    get authToken() { return need("TWILIO_AUTH_TOKEN"); },
    /** Our one WhatsApp business number, e.g. whatsapp:+15551234567 */
    get whatsappFrom() { return need("TWILIO_WHATSAPP_FROM"); },
    /** Content template SIDs (approved by Meta). Optional until the templates exist. */
    get cardTemplateSid() { return process.env.TWILIO_TEMPLATE_CARD ?? null; },
    get cardNonOrderTemplateSid() { return process.env.TWILIO_TEMPLATE_CARD_NON_ORDER ?? null; },
    get noticeTemplateSid() { return process.env.TWILIO_TEMPLATE_NOTICE ?? null; },
    get samePricesTemplateSid() { return process.env.TWILIO_TEMPLATE_SAME_PRICES ?? null; },
  },
  eleven: {
    get apiKey() { return need("ELEVENLABS_API_KEY"); },
    get webhookSecret() { return need("ELEVENLABS_WEBHOOK_SECRET"); },
    get toolSecret() { return need("ELEVENLABS_TOOL_SECRET"); },
    /** Agent used for callbacks to buyers (reads the rep's exact offer). */
    get callbackAgentId() { return need("ELEVENLABS_CALLBACK_AGENT_ID"); },
  },
  email: {
    get resendKey() { return need("RESEND_API_KEY"); },
    get from() { return process.env.EMAIL_FROM ?? "Soba <desk@usesoba.com>"; },
  },
  get adminToken() { return need("ADMIN_TOKEN"); },
  /** Signs the panel and admin cookies. Required in production; a fixed dev value otherwise. */
  get sessionSecret() { return process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? need("SESSION_SECRET") : "soba-dev-secret"); },
  /** Names of the variables a production deploy must have; the health route reports the missing ones. */
  missing(): string[] {
    const want = ["APP_URL", "DATABASE_URL", "SESSION_SECRET", "ADMIN_TOKEN", "GEMINI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "ELEVENLABS_API_KEY", "ELEVENLABS_WEBHOOK_SECRET", "ELEVENLABS_TOOL_SECRET", "ELEVENLABS_CALLBACK_AGENT_ID", "RESEND_API_KEY", "CRON_SECRET"];
    return want.filter((k) => !process.env[k]);
  },
  /** True when outbound messages and calls should only be logged, never sent. */
  get dryRun() { return process.env.SOBA_DRY_RUN === "1" || process.env.NODE_ENV === "test"; },
};
