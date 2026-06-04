import type { WebClient } from "@slack/web-api";
import type { BotTool } from "@copilotkit/bot";
import type { StandardSchemaV1 } from "@copilotkit/shared";

/**
 * Object-shaped Standard Schema, mirroring `@copilotkit/bot`'s internal
 * `ObjectSchema` bound (which isn't re-exported from its public entry).
 * Used to constrain {@link SlackBotTool}'s `parameters` generic the same
 * way `BotTool` does.
 */
export type ObjectSchema = StandardSchemaV1<unknown, Record<string, unknown>>;

/** Slack-specific tool context merged into a BotTool handler's ctx (mirrors the old FrontendToolContext). */
export interface SlackToolContext {
  client: WebClient;
  channel: string;
  threadTs?: string;
  botUserId: string;
  senderUserId?: string;
  conversationKey?: string;
  signal?: AbortSignal;
  postFile?(args: {
    bytes: Uint8Array;
    filename: string;
    title?: string;
    altText?: string;
  }): Promise<{ ok: boolean; fileId?: string; error?: string }>;
}

/** A BotTool whose handler ctx carries the Slack tool context. */
export type SlackBotTool<Schema extends ObjectSchema = ObjectSchema> = BotTool<
  Schema,
  SlackToolContext
>;
