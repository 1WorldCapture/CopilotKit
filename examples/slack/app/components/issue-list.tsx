/**
 * `issue_list` — renders a set of Linear issues as a clean Block Kit card:
 * a header, then one scannable row per issue (status dot + linked identifier
 * + title, with a greyed meta line for assignee / priority / updated), with
 * dividers between rows and a count footer.
 *
 * The agent fetches issues from the Linear MCP server and passes the fields
 * it wants shown; the Slack formatting lives here. For a single issue (or
 * right after creating one) prefer `issue_card`, which shows a full grid.
 *
 * Authored with the `@copilotkit/bot-ui` JSX vocabulary.
 */
import { z } from "zod";
import {
  Context,
  Divider,
  Header,
  Message,
  Section,
  type IRNode,
} from "@copilotkit/bot-ui";
import {
  accentForIssues,
  priorityShortcode,
  stateShortcode,
} from "./_status.js";

const issueSchema = z.object({
  identifier: z.string().describe("Linear issue identifier, e.g. 'CPK-1234'."),
  title: z.string().describe("Issue title."),
  url: z.string().optional().describe("Link to the issue in Linear."),
  state: z
    .string()
    .optional()
    .describe("Workflow state name, e.g. 'Todo', 'In Progress', 'Done'."),
  assignee: z
    .string()
    .optional()
    .describe("Assignee display name, or omit if unassigned."),
  priority: z
    .string()
    .optional()
    .describe("Priority label, e.g. 'Urgent', 'High', 'Medium', 'Low'."),
  updated: z
    .string()
    .optional()
    .describe("Human-readable last-updated, e.g. '2d ago'."),
});

export const issueListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional heading, e.g. 'Open CPK issues this cycle'."),
  issues: z.array(issueSchema).min(1).describe("The issues to render."),
});

export type IssueListProps = z.infer<typeof issueListSchema>;
type Issue = z.infer<typeof issueSchema>;

/** Render a list of Linear issues as a Block Kit card. */
export function IssueList({ heading, issues }: IssueListProps): IRNode {
  const rows: IRNode[] = [];
  issues.forEach((issue: Issue, i: number) => {
    const idLink = issue.url
      ? `[**${issue.identifier}**](${issue.url})`
      : `**${issue.identifier}**`;

    const prio = priorityShortcode(issue.priority);
    const meta = [
      issue.state,
      issue.assignee
        ? `:bust_in_silhouette: ${issue.assignee}`
        : "unassigned",
      issue.priority ? `${prio ? `${prio} ` : ""}${issue.priority}` : null,
      issue.updated ? `:clock3: ${issue.updated}` : null,
    ]
      .filter(Boolean)
      .join("   ·   ");

    rows.push(
      <Section>{`${stateShortcode(issue.state)}  ${idLink}  ${issue.title}`}</Section>,
      <Context>{meta}</Context>,
    );
    if (i < issues.length - 1) rows.push(<Divider />);
  });

  return (
    <Message accent={accentForIssues(issues)}>
      <Header>{`📋  ${heading ?? "Linear issues"}`}</Header>
      {rows}
      <Context>{`${issues.length} issue${issues.length === 1 ? "" : "s"}`}</Context>
    </Message>
  );
}
