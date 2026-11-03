import Anthropic from "@anthropic-ai/sdk";

/** Every LLM step in Soba runs on Claude. Override the model with SOBA_MODEL. */
export const MODEL = process.env.SOBA_MODEL ?? "claude-opus-5-5";

let _client: Anthropic | undefined;
export function llm(): Anthropic {
  _client ??= new Anthropic();
  return _client;
}

/** True when a key or profile is available; tests that hit the API skip otherwise. */
export function hasLlmCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
