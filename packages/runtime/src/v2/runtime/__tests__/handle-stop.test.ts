import { describe, expect, it, vi } from "vitest";
import { handleStopAgent } from "../handlers/handle-stop";
import type { CopilotRuntime } from "../core/runtime";

describe("handleStopAgent", () => {
  it("uses runner.stop even when an SSE thread backend is configured", async () => {
    const stopSpy = vi.fn().mockResolvedValue(true);
    const threadBackend = {
      listThreads: vi.fn(),
      updateThread: vi.fn(),
      archiveThread: vi.fn(),
      deleteThread: vi.fn(),
      getThreadMessages: vi.fn(),
      getThreadEvents: vi.fn(),
      getThreadState: vi.fn(),
    };

    const runtime = {
      agents: Promise.resolve({ "test-agent": { clone: () => ({}) } }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      runner: {
        run: vi.fn(),
        connect: vi.fn(),
        isRunning: vi.fn(),
        stop: stopSpy,
      },
      threadBackend,
    } as unknown as CopilotRuntime;

    const response = await handleStopAgent({
      runtime,
      request: new Request(
        "https://example.com/agent/test-agent/stop/thread-1",
        {
          method: "POST",
        },
      ),
      agentId: "test-agent",
      threadId: "thread-1",
    });

    expect(response.status).toBe(200);
    expect(stopSpy).toHaveBeenCalledWith({
      threadId: "thread-1",
      ownership: {},
    });
    expect(threadBackend.listThreads).not.toHaveBeenCalled();
  });
});
