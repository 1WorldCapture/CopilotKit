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
import type { AnyBotTool } from "@copilotkit/bot";

/**
 * The Slack-context tools (read_thread, render_*) are typed
 * `BotTool<Schema, SlackToolContext>`: their handler ctx is narrowed to the
 * Slack tool context the adapter supplies at call time. `AnyBotTool` is the
 * adapter-agnostic tool shape `createBot({ tools })` accepts — its ctx is
 * supplied at runtime by the adapter (see `SlackAdapter.toolContext`), so the
 * Slack-narrowed tools assign directly with no cast.
 */
export const appTools: AnyBotTool[] = [
  readThreadTool,
  renderChartTool,
  renderDiagramTool,
  renderTableTool,
  issueCardTool,
  issueListTool,
  pageListTool,
];

export {
  readThreadTool,
  renderChartTool,
  renderDiagramTool,
  renderTableTool,
  issueCardTool,
  issueListTool,
  pageListTool,
};
