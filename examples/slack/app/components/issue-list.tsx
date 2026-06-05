/**
 * `issue_list` — renders a set of Linear issues as a compact, aligned Slack
 * table: a header, a single native Table block (status dot · identifier ·
 * title · assignee · updated), and a count footer.
 *
 * Table cells are plain `raw_text` — no links, no mrkdwn/bold, no `:shortcode:`
 * emoji — so we use the UNICODE status glyph (`stateUnicode`) and plain strings.
 * The agent fetches issues from the Linear MCP server and passes the fields it
 * wants shown; the Slack formatting lives here. For a single issue (or right
 * after creating one) prefer `issue_card`, which shows a full grid.
 *
 * Authored with the `@copilotkit/bot-ui` JSX vocabulary.
 */
import { z } from "zod";
import { Cell, Context, Header, Message, Row, Table } from "@copilotkit/bot-ui";
import { accentForIssues, stateUnicode } from "./_status.js";

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

/** Render a list of Linear issues as a compact Slack table. */
export function IssueList({ heading, issues }: IssueListProps) {
  const truncate = (s: string, n = 48) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;
  return (
    <Message accent={accentForIssues(issues)}>
      <Header>{heading ?? "Linear issues"}</Header>
      <Table
        columns={[
          { header: "", align: "center" },
          { header: "Issue" },
          { header: "Title" },
          { header: "Assignee" },
          { header: "Updated", align: "right" },
        ]}
      >
        {issues.map((i) => (
          <Row>
            <Cell>{stateUnicode(i.state)}</Cell>
            <Cell>{i.identifier}</Cell>
            <Cell>{truncate(i.title)}</Cell>
            <Cell>{i.assignee ?? "—"}</Cell>
            <Cell>{i.updated ?? ""}</Cell>
          </Row>
        ))}
      </Table>
      <Context>{`${issues.length} issue${issues.length === 1 ? "" : "s"}`}</Context>
    </Message>
  );
}
