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

  it("renders an input block with its stamped action_id", () => {
    expect(
      renderBlockKit([
        { type: "input", props: { onSubmit: { id: "ck:in1" }, placeholder: "Name", multiline: false } },
      ]),
    ).toEqual([
      {
        type: "input",
        dispatch_action: true,
        element: { type: "plain_text_input", action_id: "ck:in1", multiline: false },
        label: { type: "plain_text", text: "Name" },
      },
    ]);
  });

  it("gives a static_select a fallback action_id when onSelect is absent", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [{ type: "select", props: { options: [{ label: "A", value: "a" }] } }],
        },
      },
    ]);
    const select = (blocks[0] as { elements: { action_id: string }[] }).elements[0];
    expect(select.action_id).toBe("select");
    expect(select.action_id.length).toBeGreaterThan(0);
  });

  it("passes raw native Block Kit through unchanged", () => {
    expect(
      renderBlockKit([
        { type: "raw", props: { value: [{ type: "section", text: { type: "mrkdwn", text: "native" } }] } },
      ]),
    ).toEqual([{ type: "section", text: { type: "mrkdwn", text: "native" } }]);
  });
});
