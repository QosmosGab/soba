// Every model step in Soba runs on Gemini through the Google Gen AI SDK, and
// every one asks for JSON that matches a zod schema: the model is told the
// schema, the reply is parsed and validated, and a blocked or truncated reply
// is an error the caller handles (never a half-read order).
import { GoogleGenAI, createPartFromBase64, createUserContent, type Part } from "@google/genai";
import { z } from "zod";

/** Override with SOBA_MODEL. */
export const MODEL = process.env.SOBA_MODEL ?? "gemini-3.1-pro-preview";

let _client: GoogleGenAI | undefined;
export function llm(): GoogleGenAI {
  _client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY });
  return _client;
}

/** True when a key is available; tests that hit the API skip otherwise. */
export function hasLlmCredentials(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export type Effort = "low" | "medium" | "high";
export type Attachment = { base64: string; mediaType: string };

/**
 * Gemini's JSON-schema support is a subset: no `type: [..., "null"]` arrays, no `$schema`.
 * zod 4 emits both, so nullable fields become `anyOf` and the header is dropped.
 */
export function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema") continue;
      if (k === "type" && Array.isArray(v) && v.includes("null")) {
        const rest = (node as Record<string, unknown>);
        const others = v.filter((t) => t !== "null");
        const inner: Record<string, unknown> = { ...rest, type: others.length === 1 ? others[0] : others };
        delete inner.$schema;
        const { description, ...withoutDesc } = inner;
        return { ...(description ? { description } : {}), anyOf: [walk(withoutDesc), { type: "null" }] };
      }
      out[k] = walk(v);
    }
    return out;
  };
  return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export class LlmRefusal extends Error {}

/**
 * One structured call. `user` is text plus optional attachments (PDF or image, base64).
 * Thinking is left to the model at medium/high and capped low for quick classifications.
 */
export async function generateJson<T>(args: {
  schema: z.ZodType<T>; system: string; user: string; attachments?: Attachment[]; effort?: Effort; maxTokens?: number;
}): Promise<T> {
  const parts: Part[] = [...(args.attachments ?? []).map((a) => createPartFromBase64(a.base64, a.mediaType)), { text: args.user }];
  const response = await llm().models.generateContent({
    model: MODEL,
    contents: createUserContent(parts),
    config: {
      systemInstruction: args.system,
      responseMimeType: "application/json",
      responseJsonSchema: geminiSchema(args.schema),
      maxOutputTokens: args.maxTokens ?? 4000,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: args.effort === "low" ? 1024 : -1 },
    },
  });
  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new LlmRefusal(`Request blocked: ${blocked}`);
  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== "STOP") throw new LlmRefusal(`Reply stopped: ${finish}`);
  const text = response.text;
  if (!text) throw new LlmRefusal("Empty reply");
  return args.schema.parse(JSON.parse(text));
}
