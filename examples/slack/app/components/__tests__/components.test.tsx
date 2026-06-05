/**
 * Block Kit parity tests for the JSX render components. Each component is a
 * `@copilotkit/bot-ui` `ComponentFn`; we assert the full
 * `renderSlackMessage(renderToIR(<… />))` output — both the `blocks` and the
 * attachment `accent` — against the legacy `defineSlackComponent` shapes.
 *
 * The shared IR→mrkdwn path runs section/field/context text through
 * `markdownToMrkdwn`, so the components author Markdown bold (`**x**`) which
 * the transform rewrites into Slack bold (`*x*`). The block structure,
 * ordering, emoji, dividers, footers and accent colors match the legacy
 * `.ts` output, and the link/label forms below assert the Slack-bold `*…*`
 * the old `defineSlackComponent` code produced.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
import { IssueList } from "../issue-list.js";
import { IssueCard } from "../issue-card.js";
import { PageList } from "../page-list.js";

describe("IssueList component", () => {
  it("renders a header, a status table and a count footer", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueList
          heading="Open"
          issues={[
            {
              identifier: "CPK-101",
              title: "Checkout 500s under load",
              url: "https://linear.app/copilotkit/issue/CPK-101",
              state: "In Progress",
              assignee: "Alem",
              priority: "Urgent",
              updated: "2d ago",
            },
            {
              identifier: "CPK-9",
              title: "No assignee",
            },
          ]}
        />,
      ),
    );

    // Leads with a plain header carrying the heading.
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Open" },
    });

    // A single native table block.
    const table = blocks.find((b) => b.type === "table") as {
      rows: { type: "raw_text"; text: string }[][];
      column_settings: { align: string }[];
    };
    expect(table).toBeDefined();

    // Header row: empty status col + Issue / Title / Assignee / Updated.
    expect(table.rows[0]).toEqual([
      { type: "raw_text", text: "" },
      { type: "raw_text", text: "Issue" },
      { type: "raw_text", text: "Title" },
      { type: "raw_text", text: "Assignee" },
      { type: "raw_text", text: "Updated" },
    ]);

    // One data row per issue: status unicode + identifier + title + assignee + updated.
    expect(table.rows[1]).toEqual([
      { type: "raw_text", text: "🔵" },
      { type: "raw_text", text: "CPK-101" },
      { type: "raw_text", text: "Checkout 500s under load" },
      { type: "raw_text", text: "Alem" },
      { type: "raw_text", text: "2d ago" },
    ]);
    // Missing state → orange dot; missing assignee → em dash; missing updated → "".
    expect(table.rows[2]).toEqual([
      { type: "raw_text", text: "🟠" },
      { type: "raw_text", text: "CPK-9" },
      { type: "raw_text", text: "No assignee" },
      { type: "raw_text", text: "—" },
      { type: "raw_text", text: "" },
    ]);
    expect(table.rows).toHaveLength(3);

    // Column alignment: status centered, updated right-aligned, rest left.
    expect(table.column_settings).toEqual([
      { align: "center" },
      { align: "left" },
      { align: "left" },
      { align: "left" },
      { align: "right" },
    ]);

    // Count footer.
    const footer = blocks.at(-1);
    expect(footer?.type).toBe("context");
    expect(JSON.stringify(footer)).toContain("2 issues");

    // Hottest priority (Urgent) drives the accent.
    expect(accent).toBe("#EB5757");
  });

  it("truncates long titles and falls back to Linear purple without urgent/high", () => {
    const long = "x".repeat(60);
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueList issues={[{ identifier: "CPK-1", title: long }]} />,
      ),
    );
    const table = blocks.find((b) => b.type === "table") as {
      rows: { type: "raw_text"; text: string }[][];
    };
    // Title clamped to 48 chars (47 + ellipsis).
    expect(table.rows[1]?.[2]).toEqual({
      type: "raw_text",
      text: `${"x".repeat(47)}…`,
    });
    // Singular footer.
    expect(JSON.stringify(blocks)).toContain("1 issue");
    // No urgent/high priority → Linear purple.
    expect(accent).toBe("#5E6AD2");
  });
});

describe("IssueCard component", () => {
  it("renders a status header, linked title and a fields grid", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueCard
          identifier="CPK-101"
          title="Checkout 500s under load"
          url="https://linear.app/copilotkit/issue/CPK-101"
          state="In Progress"
          assignee="Alem"
          priority="Urgent"
          team="CPK"
        />,
      ),
    );

    const json = JSON.stringify(blocks);
    // Header: in-progress unicode dot + identifier (plain_text, untouched).
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "🔵 CPK-101" },
    });
    // Title section with the linked, bold title.
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*Checkout 500s under load*>",
    );
    // A section carries the 2-column metadata grid.
    const fieldsSection = blocks.find(
      (b) => b.type === "section" && "fields" in b && Array.isArray(b.fields),
    ) as { fields: { text: string }[] } | undefined;
    expect(fieldsSection).toBeDefined();
    expect(fieldsSection?.fields).toHaveLength(4);
    expect(json).toContain("*Assignee*\\nAlem");
    expect(json).toContain("*Priority*\\n:rotating_light: Urgent");
    expect(json).toContain("*Status*\\n:large_blue_circle: In Progress");
    expect(json).toContain("*Team*\\nCPK");
    // Footer: "Open in Linear" link.
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|Open in Linear →>",
    );
    // Urgent priority drives the accent.
    expect(accent).toBe("#EB5757");
  });

  it("shows a 'Filed' banner and a check header when justCreated", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueCard identifier="CPK-200" title="New bug" justCreated />,
      ),
    );
    const json = JSON.stringify(blocks);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "✅ CPK-200" },
    });
    expect(json).toContain(":sparkles: Filed in Linear");
    // The Filed banner sits before the fields grid.
    const bannerIdx = blocks.findIndex(
      (b) => b.type === "context" && json.includes("Filed in Linear"),
    );
    const fieldsIdx = blocks.findIndex(
      (b) => b.type === "section" && "fields" in b,
    );
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(fieldsIdx);
    // unassigned fallback + Status placeholder grid still render.
    expect(json).toContain("_unassigned_");
    // No priority/state → Linear purple.
    expect(accent).toBe("#5E6AD2");
  });

  it("appends a divider + trimmed description when present", () => {
    const long = "x".repeat(700);
    const { blocks } = renderSlackMessage(
      renderToIR(
        <IssueCard identifier="CPK-300" title="Big" description={long} />,
      ),
    );
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(1);
    const descSection = blocks[blocks.length - 1] as {
      text?: { text: string };
    };
    // Description is trimmed to 600 chars + an ellipsis.
    expect(descSection.text?.text).toBe(`${"x".repeat(600)}…`);
  });
});

describe("PageList component", () => {
  it("renders linked titles, snippets and a count footer", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <PageList
          heading="Runbooks"
          pages={[
            {
              title: "Auth outage runbook",
              url: "https://www.notion.so/abc",
              snippet: "Steps to mitigate auth provider downtime.",
              edited: "3d ago",
            },
            { title: "No-link page" },
          ]}
        />,
      ),
    );
    const json = JSON.stringify(blocks);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "📚  Runbooks" },
    });
    expect(json).toContain(
      "<https://www.notion.so/abc|*Auth outage runbook*>",
    );
    expect(json).toContain("Steps to mitigate auth provider downtime.");
    expect(json).toContain(":clock3: edited 3d ago");
    // A page without a url renders as bold text rather than a link.
    expect(json).toContain("*No-link page*");
    expect(json).not.toContain("|*No-link page*>");
    expect(json).toContain("2 pages");
    // Exactly one divider between the two pages.
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(1);
    // Notion-dark accent.
    expect(accent).toBe("#2F3437");
  });
});
