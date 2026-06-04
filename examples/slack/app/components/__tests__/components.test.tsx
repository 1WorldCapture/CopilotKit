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
  it("renders a header, a status row and a meta line per issue", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueList
          heading="Open CPK issues"
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
          ]}
        />,
      ),
    );

    const json = JSON.stringify(blocks);
    // Leads with a header block carrying the list emoji + heading.
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "📋  Open CPK issues" },
    });
    // The identifier is a linked, bold label (Markdown bold → Slack bold).
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*CPK-101*>",
    );
    expect(json).toContain("Checkout 500s under load");
    // In-progress maps to the blue dot; Urgent to the siren.
    expect(json).toContain(":large_blue_circle:");
    expect(json).toContain(":rotating_light:");
    expect(json).toContain("Alem");
    // Count footer.
    expect(json).toContain("1 issue");
    // Hottest priority (Urgent) drives the accent.
    expect(accent).toBe("#EB5757");
  });

  it("puts a divider between issues but not after the last", () => {
    const { blocks } = renderSlackMessage(
      renderToIR(
        <IssueList
          issues={[
            { identifier: "CPK-1", title: "a" },
            { identifier: "CPK-2", title: "b" },
          ]}
        />,
      ),
    );
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(1);
  });

  it("falls back to an emphasized identifier and 'unassigned' when fields are missing", () => {
    const { blocks, accent } = renderSlackMessage(
      renderToIR(
        <IssueList issues={[{ identifier: "CPK-9", title: "No assignee" }]} />,
      ),
    );
    const json = JSON.stringify(blocks);
    // No url → bold identifier, no link wrapper.
    expect(json).toContain("*CPK-9*");
    expect(json).not.toContain("|*CPK-9*>");
    expect(json).toContain("unassigned");
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
