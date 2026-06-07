import type { OwnershipContext, OwnershipMode } from "@copilotkit/runtime/v2";

export interface SqliteOwnershipOptions {
  mode?: OwnershipMode;
}

export function normalizeOwnershipMode(mode?: OwnershipMode): OwnershipMode {
  return mode ?? "disabled";
}

export function getOwnershipOwnerId(
  mode: OwnershipMode,
  ownership?: OwnershipContext,
): string | null | undefined {
  if (mode === "disabled") {
    return undefined;
  }

  return ownership?.ownerId ?? null;
}
