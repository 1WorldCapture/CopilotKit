import type { IRNode } from "./ir.js";
import { describe, it, expect } from "vitest";
import { renderToIR } from "./render.js";
import { Message, Header, Section, Actions, Button, Divider } from "./components.js";

describe("component vocabulary", () => {
  it("Message wraps children with intrinsic type 'message'", () => {
    const out = renderToIR(<Message><Header>Hi</Header></Message>);
    expect(out[0]!.type).toBe("message");
  });
  it("Button carries onClick and style in props", () => {
    const fn = () => {};
    const out = renderToIR(<Actions><Button onClick={fn} style="primary">Go</Button></Actions>);
    const actions = out[0]!;
    const button = (actions.props.children as IRNode[])[0] as IRNode;
    expect(button.type).toBe("button");
    expect(button.props.onClick).toBe(fn);
    expect(button.props.style).toBe("primary");
  });
  it("Divider renders with no children", () => {
    const out = renderToIR(<Divider />);
    expect(out[0]).toMatchObject({ type: "divider" });
  });
});
