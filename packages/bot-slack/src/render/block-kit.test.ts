import { Header, Message, Section, renderToIR, type IRNode } from "@copilotkit/bot-ui";
import { describe, expect, it } from "vitest";
import { renderBlockKit } from "./block-kit.js";

describe("renderBlockKit", () => {
  it("flattens a message into header + section blocks (markdown → mrkdwn)", () => {
    const ir = renderToIR(
      Message({ children: [Header({ children: "Hi" }), Section({ children: "**bold**" })] }),
    );
    expect(renderBlockKit(ir)).toEqual([
      { type: "header", text: { type: "plain_text", text: "Hi" } },
      { type: "section", text: { type: "mrkdwn", text: "*bold*" } },
    ]);
  });

  it("renders a pre-bound button inside actions with its stamped action_id", () => {
    const ir: IRNode[] = [
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                onClick: { id: "ck:abc" },
                value: { confirmed: true },
                style: "primary",
                children: [{ type: "text", props: { value: "Create" } }],
              },
            },
          ],
        },
      },
    ];
    expect(renderBlockKit(ir)).toEqual([
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "ck:abc",
            text: { type: "plain_text", text: "Create" },
            value: '{"confirmed":true}',
            style: "primary",
          },
        ],
      },
    ]);
  });

  it("renders a divider", () => {
    expect(renderBlockKit([{ type: "divider", props: {} }])).toEqual([{ type: "divider" }]);
  });

  it("applies the section text budget (≤3000, trailing ellipsis)", () => {
    const blocks = renderBlockKit(renderToIR(Section({ children: "x".repeat(4000) })));
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text.length).toBeLessThanOrEqual(3000);
    expect(section.text.text.endsWith("…")).toBe(true);
  });

  it("passes raw native Block Kit through unchanged", () => {
    expect(
      renderBlockKit([
        { type: "raw", props: { value: [{ type: "section", text: { type: "mrkdwn", text: "native" } }] } },
      ]),
    ).toEqual([{ type: "section", text: { type: "mrkdwn", text: "native" } }]);
  });
});
