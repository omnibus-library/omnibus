import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  type ApiTokenView,
  apiTokensQuery,
  createApiToken,
  renameApiToken,
  revokeApiToken,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { CopyButton } from "../../components/CopyButton/CopyButton";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
} from "../../components/SettingsShell/SettingsShell";
import { initialsFor, nowSecs, utcDay } from "../../format";
import { useCurrentUser } from "../../session";
import { mcpCommand, type PillTone, relDate, statusPill } from "./apiTokens";

const NAME_REQUIRED = "Enter a name for the token.";
const NameSchema = z.object({ name: z.string().trim().min(1, NAME_REQUIRED) });

// Spelled out here, not in apiTokens.ts, because the Atrium extractor reads only .tsx.
const PILL_CLASS = {
  unused: "tkx-pill-unused",
  active: "tkx-pill-active",
  idle: "tkx-pill-idle",
} satisfies Record<PillTone, string>;

const CREATE_HINT =
  "Name it after the machine or client that will hold it — that name is all you get when deciding what to revoke later.";

type Secret = { name: string; secret: string };

type CreateFormProps = {
  label: string;
  hint: boolean;
  pending: boolean;
  /** `onCreated` empties the field once the token exists, so a refusal keeps the name. */
  onCreate: (name: string, onCreated: () => void) => void;
  onInvalid: (message: string) => void;
};

function CreateForm({
  label,
  hint,
  pending,
  onCreate,
  onInvalid,
}: CreateFormProps) {
  const form = useForm({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: "" },
  });
  return (
    <form
      className="settings-form tkx-create"
      onSubmit={form.handleSubmit(
        ({ name }) => onCreate(name, () => form.reset()),
        (errors) => onInvalid(errors.name?.message ?? NAME_REQUIRED),
      )}
    >
      <div className="settings-field">
        <label htmlFor="api-token-name">Token name</label>
        <input
          type="text"
          id="api-token-name"
          data-testid="api-token-name-input"
          autoComplete="off"
          placeholder="e.g. MCP on my laptop…"
          maxLength={100}
          {...form.register("name")}
        />
        {hint && <p className="tkx-create-hint">{CREATE_HINT}</p>}
      </div>
      <div className="settings-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          aria-busy={pending}
          data-testid="api-token-create"
        >
          <BusyLabel busy={pending} label={label} busyLabel="Creating…" />
        </Button>
      </div>
    </form>
  );
}

/** The one-time secret panel: shown until dismissed, since it can never be fetched again. */
function SecretHandOff({
  secret,
  onDismiss,
}: {
  secret: Secret;
  onDismiss: () => void;
}) {
  const command = mcpCommand(window.location.origin, secret.secret);
  return (
    <div className="tkx-secret" data-testid="api-token-secret-field">
      <div className="tkx-secret-head">
        <h4>{secret.name}</h4>
        <span className="tkx-secret-once">shown once</span>
      </div>
      <p className="tkx-secret-sub">
        This is the only time the secret is readable. Store it in the client now
        — if you lose it, revoke the token and make another.
      </p>
      <div className="tkx-copyrow">
        <div
          className="tkx-copyfield"
          data-testid="api-token-secret"
          translate="no"
        >
          {secret.secret}
        </div>
        <CopyButton
          text={secret.secret}
          label="Copy secret"
          testId="api-token-secret-copy"
          variant="primary"
        />
      </div>
      <div className="tkx-secret-next">
        <span className="label">Connect an MCP client</span>
        <div className="tkx-cmd">
          <code data-testid="api-token-mcp-command" translate="no">
            {command}
          </code>
          <CopyButton
            text={command}
            label="Copy"
            testId="api-token-mcp-command-copy"
            ariaLabel="Copy the MCP command"
          />
        </div>
      </div>
      <div className="tkx-secret-done">
        <Button data-testid="api-token-secret-dismiss" onClick={onDismiss}>
          Hide secret
        </Button>
        <span className="mono">dismissing hides the secret for good</span>
      </div>
    </div>
  );
}

type RowProps = {
  token: ApiTokenView;
  disabled: boolean;
  onRename: () => void;
  onRevoke: () => void;
};

function TokenRow({ token, disabled, onRename, onRevoke }: RowProps) {
  const now = nowSecs();
  const pill = statusPill(now, token.last_used_at);
  return (
    <li className="tkx-row" data-testid="api-token-row">
      <div className="tkx-row-name">
        <span className="tkx-row-title">{token.name}</span>
        {/* A token from before suffixes were recorded has no identifier to show. */}
        {token.suffix && (
          <span className="tkx-row-id" translate="no">
            omni_…{token.suffix}
          </span>
        )}
      </div>
      <span
        className={`tkx-pill ${PILL_CLASS[pill.tone]}`}
        data-testid="api-token-pill"
      >
        {pill.label}
      </span>
      <span className="tkx-cell">
        {relDate(now, token.created_at)}
        <span className="mono">{utcDay(token.created_at)}</span>
      </span>
      <span className="tkx-cell">
        {token.last_used_at == null
          ? "never"
          : relDate(now, token.last_used_at)}
        {token.last_used_at != null && (
          <span className="mono">{utcDay(token.last_used_at)}</span>
        )}
      </span>
      <span className="tkx-row-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Rename ${token.name}`}
          data-testid={`api-token-rename-${token.id}`}
          onClick={onRename}
        >
          Rename
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="bad"
          disabled={disabled}
          aria-label={`Revoke ${token.name}`}
          data-testid={`api-token-revoke-${token.id}`}
          onClick={onRevoke}
        >
          Revoke
        </Button>
      </span>
    </li>
  );
}

function RevokeConfirmRow({
  token,
  disabled,
  onCancel,
  onRevoke,
}: {
  token: ApiTokenView;
  disabled: boolean;
  onCancel: () => void;
  onRevoke: () => void;
}) {
  return (
    <li className="tkx-row-confirm" data-testid="api-token-revoke-confirm">
      <span className="tkx-confirm-text">
        Revoke <b>{token.name}</b>? The client using it stops working on its
        next request. This can’t be undone — you’d have to issue a new token.
      </span>
      <Button
        variant="ghost"
        disabled={disabled}
        data-testid="api-token-revoke-cancel"
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        variant="bad"
        disabled={disabled}
        data-testid={`api-token-revoke-confirm-${token.id}`}
        onClick={onRevoke}
      >
        Revoke token
      </Button>
    </li>
  );
}

function RenameRow({
  token,
  disabled,
  onCancel,
  onRename,
  onInvalid,
}: {
  token: ApiTokenView;
  disabled: boolean;
  onCancel: () => void;
  onRename: (name: string) => void;
  onInvalid: (message: string) => void;
}) {
  const form = useForm({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: token.name },
  });
  return (
    <li
      className="tkx-row-confirm tkx-row-edit"
      data-testid="api-token-rename-row"
    >
      <form
        className="tkx-rename-form"
        onSubmit={form.handleSubmit(
          ({ name }) => onRename(name),
          (errors) => onInvalid(errors.name?.message ?? NAME_REQUIRED),
        )}
      >
        <input
          type="text"
          data-testid="api-token-rename-input"
          aria-label="New token name"
          autoComplete="off"
          maxLength={100}
          {...form.register("name")}
        />
        <Button
          variant="ghost"
          disabled={disabled}
          data-testid="api-token-rename-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled}
          data-testid="api-token-rename-save"
        >
          Save name
        </Button>
      </form>
    </li>
  );
}

/** What the signed-in account lets a token do: a token carries all of it. */
function scopeChips(user: ReturnType<typeof useCurrentUser>): string[] {
  const chips = [];
  if (user.isAdmin) chips.push("Admin");
  if (user.isAdmin || user.canUpload) chips.push("Upload");
  if (user.isAdmin || user.canEdit) chips.push("Edit");
  if (user.isAdmin || user.canDownload) chips.push("Download");
  return chips;
}

/** Long-lived API tokens: create one and hand its secret over once, rename, or revoke. */
export function ApiTokensCard() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const tokens = useQuery(apiTokensQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);

  const setList = (change: (list: ApiTokenView[]) => ApiTokenView[]) =>
    queryClient.setQueryData(apiTokensQuery.queryKey, (list) =>
      change(list ?? []),
    );
  const fail = (error: Error) =>
    setStatus({ message: error.message, error: true });
  // After a refusal the list is read again, so it shows what the server holds.
  const refused = (error: Error) => {
    fail(error);
    void queryClient.invalidateQueries({ queryKey: apiTokensQuery.queryKey });
  };
  const invalid = (message: string) => setStatus({ message, error: true });
  const create = useMutation({
    mutationFn: createApiToken,
    onMutate: async () => {
      setStatus(null);
      // A list read still in flight would land over the new row.
      await queryClient.cancelQueries({ queryKey: apiTokensQuery.queryKey });
    },
    onSuccess: ({ token, secret: raw }) => {
      setList((list) => [token, ...list]);
      setSecret({ name: token.name, secret: raw });
      // Announces the secret panel through the live status line.
      setStatus({
        message:
          "Token created. Copy its secret now, since it isn’t shown again.",
        error: false,
      });
    },
    onError: fail,
    // A list that had not answered is read again, not replaced by the new token alone.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: apiTokensQuery.queryKey }),
  });
  const revoke = useMutation({
    mutationFn: revokeApiToken,
    onMutate: () => setStatus(null),
    onSuccess: (_, id) => {
      setList((list) => list.filter((t) => t.id !== id));
      setRevoking(null);
      setStatus({ message: "Token revoked.", error: false });
    },
    onError: refused,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      renameApiToken(id, name),
    onMutate: () => setStatus(null),
    onSuccess: (_, { id, name }) => {
      setList((list) => list.map((t) => (t.id === id ? { ...t, name } : t)));
      setRenaming(null);
    },
    onError: refused,
  });
  const busy = create.isPending || revoke.isPending || rename.isPending;

  const list = tokens.data;
  const shown =
    status ??
    (tokens.isError ? { message: tokens.error.message, error: true } : null);
  const chips = scopeChips(user);
  const count = list?.length ?? 0;
  const empty = list?.length === 0;

  return (
    <div className="tkx-tokens" data-testid="api-tokens-card">
      <div className="tkx-head">
        <div>
          <h3 className="tkx-title">API tokens</h3>
          <p className="tkx-lede">
            Long-lived tokens let an API client — an MCP server, a script, a
            shortcut — act as you. They never expire on their own; revoking one
            here cuts the client off immediately.
          </p>
        </div>
        {/* Never "0 live tokens" before the list has answered. */}
        {list ? (
          <span className="tkx-count" data-testid="api-tokens-count">
            {count} live {count === 1 ? "token" : "tokens"}
          </span>
        ) : (
          <span className="tkx-count" data-testid="api-tokens-count-pending">
            <span className="ld-sheen">Counting</span>
          </span>
        )}
      </div>

      <div className="tkx-scope" data-testid="api-tokens-scope">
        <span className="tkx-scope-who">
          <span
            className="tkx-scope-avatar"
            title={user.name}
            aria-hidden="true"
          >
            {initialsFor(user.name)}
          </span>
          Every token carries your account’s permissions, in full:
        </span>
        <span className="tkx-scope-chips">
          {chips.map((chip) => (
            <span key={chip} className="tkx-scope-chip">
              {chip}
            </span>
          ))}
        </span>
      </div>

      {/* One section either way, so a name typed while the list loads survives its answer. */}
      <section
        className={empty ? "card tkx-empty" : "card"}
        data-testid={empty ? "api-tokens-empty" : undefined}
      >
        {empty && (
          <>
            <div>
              <h4 className="tkx-empty-title">No tokens yet</h4>
              <p className="tkx-lede">
                You only need one if something outside this browser has to reach
                your library.
              </p>
            </div>
            <ol className="tkx-steps">
              <li>
                <span>Name the token after the client that will hold it.</span>
              </li>
              <li>
                <span>
                  Copy the secret — it is shown once, at creation, and never
                  again.
                </span>
              </li>
              <li>
                <span>
                  Paste it into the client, e.g.{" "}
                  <code translate="no">
                    {mcpCommand(window.location.origin, "<token>")}
                  </code>
                </span>
              </li>
            </ol>
          </>
        )}
        <CreateForm
          label={empty ? "Create first token" : "Create token"}
          hint={!empty}
          pending={create.isPending}
          onCreate={(name, onSuccess) => create.mutate(name, { onSuccess })}
          onInvalid={invalid}
        />
      </section>

      {secret && (
        <SecretHandOff secret={secret} onDismiss={() => setSecret(null)} />
      )}

      {list && list.length > 0 && (
        <section className="card">
          <div className="tkx-list-head">
            <span>Token</span>
            <span>Status</span>
            <span>Created</span>
            <span>Last used</span>
            <span />
          </div>
          <ul className="tkx-list" data-testid="api-token-list">
            {list.map((token) => {
              if (revoking === token.id) {
                return (
                  <RevokeConfirmRow
                    key={token.id}
                    token={token}
                    disabled={busy}
                    onCancel={() => setRevoking(null)}
                    onRevoke={() => revoke.mutate(token.id)}
                  />
                );
              }
              if (renaming === token.id) {
                return (
                  <RenameRow
                    key={token.id}
                    token={token}
                    disabled={busy}
                    onCancel={() => setRenaming(null)}
                    onRename={(name) => rename.mutate({ id: token.id, name })}
                    onInvalid={invalid}
                  />
                );
              }
              return (
                <TokenRow
                  key={token.id}
                  token={token}
                  disabled={busy}
                  onRename={() => {
                    setRevoking(null);
                    setRenaming(token.id);
                  }}
                  onRevoke={() => {
                    setRenaming(null);
                    setRevoking(token.id);
                  }}
                />
              );
            })}
          </ul>
        </section>
      )}

      <StatusLine testId="api-tokens-status" status={shown} />
    </div>
  );
}
