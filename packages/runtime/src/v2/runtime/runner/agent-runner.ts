import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import type { Observable } from "rxjs";
import type { OwnershipContext } from "../core/runtime";

export interface AgentRunnerRunRequest {
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
  persistedInputMessages?: Message[];
  ownership?: OwnershipContext;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  headers?: Record<string, string>;
  joinCode?: string;
  ownership?: OwnershipContext;
}

export interface AgentRunnerIsRunningRequest {
  threadId: string;
  ownership?: OwnershipContext;
}

export interface AgentRunnerStopRequest {
  threadId: string;
  ownership?: OwnershipContext;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
}
