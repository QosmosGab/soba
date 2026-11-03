# Provider setup

What has to exist in ElevenLabs, Twilio and Meta for the code in `src/` to run. Everything here is configuration, not code; the prompts are in this folder so they are versioned with the app.

## ElevenLabs

Two agents. Both use the native Twilio import of the customer's voice number (not the register-call path, which loses transfers).

### 1. Intake agent (one per customer line)

- Prompt: `intake-agent.md`, with the customer's name, greeting and business info filled in from Settings.
- First message: the customer's greeting ("Del Campo Supreme, sales. How can I help?").
- Language: English primary, Spanish enabled via the language-detection system tool. Test mixed-sentence Spanglish on day one (unconfirmed, see the vendor-facts memory).
- Webhook tool `soba_desk`: `POST {APP_URL}/api/tools/elevenlabs`, header `x-soba-tool-secret: {ELEVENLABS_TOOL_SECRET}`, body JSON with the parameters in `intake-agent.md`. `called_number` and `caller_id` are filled from `{{system__called_number}}` and `{{system__caller_id}}`; `conversation_id` from `{{system__conversation_id}}`.
- Post-call webhook: `POST {APP_URL}/api/webhooks/elevenlabs`, event `post_call_transcription`, HMAC secret = `ELEVENLABS_WEBHOOK_SECRET`. The app finds the customer by `system__called_number`.
- Data collection: none required; the app extracts from the transcript.

### 2. Callback agent (one, shared)

- Prompt: `callback-agent.md`. It reads only the dynamic variables the app passes (`intent`, `cases`, `price`, `product`, `pickup`, `ref`, `buyer_name`, `company_name`, `rep_name`, `original_cases`, `original_price`, `request_id`).
- Data collection fields (string): `outcome` (one of `confirmed`, `declined`, `changed`, `no_answer`, `bought_elsewhere`), `change_details`, `competitor`, `competitor_price`.
- Post-call webhook: same endpoint; the app recognizes the callback agent by the `intent` and `request_id` dynamic variables.
- `ELEVENLABS_CALLBACK_AGENT_ID` = this agent's id. The outbound call uses each customer's voice line (`lines.elevenPhoneNumberId`) so the buyer sees the company's number once verified caller ID is set up.

## Twilio

- Voice number per customer → imported into ElevenLabs. `lines.twilioNumber` (kind voice), `lines.companyNumber` = the customer's own line that forwards to it.
- Text number per customer (toll-free, verified) → `lines.twilioNumber` (kind text). Inbound webhook: `POST {APP_URL}/api/webhooks/twilio/sms`.
- WhatsApp sender (ours, one for all customers) → `TWILIO_WHATSAPP_FROM`. Inbound webhook: `POST {APP_URL}/api/webhooks/twilio/whatsapp`.
- Signature validation uses `APP_URL` + the request path, so `APP_URL` must be the public origin Twilio calls.

### Content templates (`templates.json`)

Create with `POST https://content.twilio.com/v1/Content`, submit each for WhatsApp approval, then put the `HX…` SIDs in the env:

| Env | Template | Buttons |
| --- | --- | --- |
| `TWILIO_TEMPLATE_CARD` | request card, 11 variables | Approve, Counter, Reject, Take over |
| `TWILIO_TEMPLATE_CARD_NON_ORDER` | non-order card, 6 variables | Take over |
| `TWILIO_TEMPLATE_NOTICE` | one-line notice, 1 variable | none |
| `TWILIO_TEMPLATE_SAME_PRICES` | nightly prompt, 1 variable | Yes, No |

Button ids carry the action and request id (`approve:<uuid>`); the app sets them per send through `ContentVariables`. Until the templates are approved, every message is sent as free text, which WhatsApp only delivers inside the 24-hour window after the rep last wrote to us.

## Meta

Business verification for Project Peach Inc. on the WhatsApp sender. Before it clears, the sender is limited to 250 unique recipients per day, which is plenty for pilots.

## Timers (Vercel Workflows + Vercel Cron)

No extra account. The undo window, card escalation and callback retry are durable workflows in `src/workflows/timers.ts` (visible under Observability → Workflows in the Vercel project). The nightly clock is `GET /api/cron/tick`, scheduled every five minutes by `vercel.json`; set `CRON_SECRET` on the project so only Vercel can call it.

## Email

Resend domain `usesoba.com` with SPF and DKIM; `EMAIL_FROM` is the sending identity, shown as "<Customer> via Soba".
