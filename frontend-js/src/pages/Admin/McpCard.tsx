import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { mcpQuery, replaceQueryData, setMcpEnabled } from "../../api";
import { CopyButton } from "./CopyButton";
import type { Status } from "./StatusLine";

const NOTES = {
  unknown: "Checking the endpoint's current state…",
  on: "Serving this library's MCP tools over streamable HTTP at /mcp. Clients authenticate with a token above.",
  off: "/mcp answers 404 until this is on. Instance-wide, and off by default.",
};

/** The switch for the hosted `/mcp` endpoint, with its address to copy. */
export function McpCard() {
  const queryClient = useQueryClient();
  const current = useQuery(mcpQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const toggle = useMutation({
    mutationFn: setMcpEnabled,
    onSuccess: async (_, enabled) => {
      await replaceQueryData(queryClient, mcpQuery.queryKey, { enabled });
      setStatus({
        text: enabled
          ? "MCP endpoint enabled at /mcp."
          : "MCP endpoint disabled. /mcp now answers 404.",
        isError: false,
      });
    },
    onError: (error) => setStatus({ text: error.message, isError: true }),
  });

  const enabled = current.data?.enabled ?? null;
  const shown: Status | null =
    status ??
    (current.isError && current.data === undefined
      ? { text: current.error.message, isError: true }
      : null);
  const endpoint = `${window.location.origin}/mcp`;
  // Unknown is its own look, with the knob at centre, never "off".
  let trackClass = "tkx-track ld-toggle-unknown";
  let stateClass = "tkx-switch-state ld-sheen";
  if (enabled !== null) {
    trackClass = enabled ? "tkx-track on" : "tkx-track";
    stateClass = "tkx-switch-state";
  }
  const stateWord =
    enabled === null ? "checking…" : enabled ? "enabled" : "disabled";
  const note =
    enabled === null ? NOTES.unknown : enabled ? NOTES.on : NOTES.off;

  return (
    <section className="card tkx-mcp" data-testid="mcp-toggle-card">
      <div className="tkx-mcp-head">
        <h3>Hosted MCP endpoint</h3>
        <span className="tkx-admin-tag">admin</span>
        <span className="tkx-switch">
          <span className={stateClass} data-testid="mcp-toggle-state">
            {stateWord}
          </span>
          {/* Until the state loads the track is a placeholder: ARIA has no "unknown" switch, so it takes no role and no aria-checked. */}
          <button
            type="button"
            className={trackClass}
            {...(enabled !== null && {
              role: "switch",
              "aria-checked": enabled,
            })}
            aria-label="Hosted MCP endpoint"
            disabled={toggle.isPending || enabled === null}
            data-testid="mcp-toggle"
            onClick={() => toggle.mutate(!enabled)}
          >
            <span className="tkx-knob" />
          </button>
        </span>
      </div>
      <p className="tkx-mcp-note">{note}</p>
      <div className="tkx-copyrow">
        <div
          className="tkx-copyfield"
          data-testid="mcp-endpoint-url"
          translate="no"
        >
          {endpoint}
        </div>
        <CopyButton
          text={endpoint}
          label="Copy URL"
          testId="mcp-endpoint-copy"
        />
      </div>
      {shown && (
        <p
          role="status"
          data-testid="mcp-toggle-status"
          className={
            shown.isError ? "settings-status error" : "settings-status success"
          }
        >
          {shown.text}
        </p>
      )}
    </section>
  );
}
