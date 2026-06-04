/**
 * App-specific frontend tools — anything that's bot-specific, not
 * universal-Slack. Universal-Slack stuff (tagging, formatting,
 * conversation model) lives in the SDK and is auto-included by
 * `defaultSlackTools` (spread in `app/index.ts`).
 *
 * Add new tools here and re-export them through `appTools`. Wire the
 * array into `createBot({tools: [...defaultSlackTools, ...appTools]})`
 * in `app/index.ts`.
 */
import { readThreadTool } from "./read-thread.js";
import { renderChartTool } from "./render-chart.js";
import { renderDiagramTool } from "./render-diagram.js";
import { renderTableTool } from "./render-table.js";
import { issueCardTool, issueListTool, pageListTool } from "./render-tools.js";
import type { BotTool } from "@copilotkit/bot";

/**
 * The Slack-context tools (read_thread, render_*) are typed
 * `BotTool<Schema, SlackToolContext>`: their handler ctx is narrowed to the
 * Slack tool context the adapter supplies at call time. That narrowed handler
 * is not *structurally* assignable to the base `BotTool` (whose ctx is the
 * open `Record<string, unknown>`), so we widen them back to `BotTool` here —
 * the same shape `createBot({ tools })` and `defaultSlackTools` use. The cast
 * is sound: the Slack adapter merges the real `SlackToolContext` into every
 * tool-call ctx (see `SlackAdapter.toolContext`).
 */
export const appTools: BotTool[] = [
  readThreadTool,
  renderChartTool,
  renderDiagramTool,
  renderTableTool,
  issueCardTool,
  issueListTool,
  pageListTool,
] as unknown as BotTool[];

export {
  readThreadTool,
  renderChartTool,
  renderDiagramTool,
  renderTableTool,
  issueCardTool,
  issueListTool,
  pageListTool,
};
