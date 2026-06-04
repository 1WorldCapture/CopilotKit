export { SlackConversationStore } from "./conversation-store.js";
export type { AgentSession } from "./conversation-store.js";

export type { ConversationKey, IncomingTurn, ReplyTarget } from "./types.js";
export { DM_SCOPE } from "./types.js";

export { MessageStream } from "./message-stream.js";
export type { MessageStreamConfig } from "./message-stream.js";

export { ChunkedMessageStream } from "./chunked-message-stream.js";
export type { ChunkedMessageStreamConfig } from "./chunked-message-stream.js";

export {
  autoCloseOpenMarkdown,
  detectOpenContext,
  renderContextOpener,
} from "./auto-close-streaming.js";
export type { OpenMarkdownContext } from "./auto-close-streaming.js";

export { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";

export { attachSlackListener } from "./slack-listener.js";
export type { ListenerConfig, TurnHandler } from "./slack-listener.js";

export {
  slackTaggingContext,
  slackFormattingContext,
  slackConversationModelContext,
  defaultSlackContext,
} from "./built-in-context.js";

export { SanitizingHttpAgent } from "./sanitizing-http-agent.js";

export { buildFileContentParts } from "./download-files.js";
export type {
  SlackFileRef,
  AgentContentPart,
  FileDeliveryConfig,
} from "./download-files.js";

// TODO(W16): export built-in tools (lookup_slack_user) as BotTool once re-expressed
// TODO(W18): export createRunRenderer from event-renderer
// TODO(W19): export slack() adapter + SlackToolContext
