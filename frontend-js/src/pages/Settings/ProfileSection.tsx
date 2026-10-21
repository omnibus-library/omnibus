import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  bumpAvatarBust,
  deleteAvatar,
  setDisplayName,
  uploadAvatar,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  refusal,
  type Status,
  StatusLine,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { patchMe, refreshMe, useCurrentUser } from "../../session";

// The server judges the rest (control characters); the input already stops at 64.
const NameSchema = z.object({ name: z.string().trim().max(64) });

/** Display name and picture. Both are account configuration, so they go straight to the server and fail inline. */
export function ProfileSection() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const form = useForm({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: user.displayName ?? "" },
  });
  const changed = form.watch("name").trim() !== (user.displayName ?? "");
  useUnsavedGuard("display-name", changed);

  const clear = () => {
    setStatus(null);
    setAvatarError(null);
  };
  const saveName = useMutation({
    mutationFn: async (name: string) => {
      await setDisplayName(name || null);
      patchMe(queryClient, (u) => ({
        ...u,
        displayName: name || null,
        name: name || u.username,
      }));
      await refreshMe(queryClient);
    },
    onMutate: clear,
    onSuccess: () => setStatus({ message: "Profile saved.", error: false }),
    onError: (error) => setStatus(refusal(error)),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      await uploadAvatar(file);
      bumpAvatarBust(user.id);
      await refreshMe(queryClient);
    },
    onMutate: clear,
    onSuccess: () =>
      setStatus({ message: "Profile picture saved.", error: false }),
    onError: (error) => setAvatarError(`Upload failed: ${error.message}`),
  });
  const remove = useMutation({
    mutationFn: async () => {
      await deleteAvatar();
      // After the reread, so no image is drawn for a photo that is gone.
      await refreshMe(queryClient);
      bumpAvatarBust(user.id);
    },
    onMutate: clear,
    onSuccess: () =>
      setStatus({ message: "Profile picture removed.", error: false }),
    onError: (error) => setAvatarError(`Remove failed: ${error.message}`),
    onSettled: () => setConfirmRemove(false),
  });
  const uploading = upload.isPending || remove.isPending;

  return (
    <section className="card" data-testid="account-profile-card">
      <h3>Profile</h3>
      <p className="subtitle">How you appear across the library.</p>

      <div className="profile-identity">
        <div className="profile-avatar">
          <UserAvatar
            user={user}
            className="profile-initials"
            photoClassName="profile-initials-photo"
          />
        </div>
        <div className="profile-avatar-actions">
          <div className="profile-avatar-buttons">
            {/* The input stays in the tab order, visually hidden; the label shows its focus. */}
            <label className="btn sm profile-avatar-pick">
              <input
                type="file"
                id="avatar-file"
                className="profile-avatar-input"
                data-testid="avatar-file-input"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so picking the same file again after a failure still fires.
                  event.target.value = "";
                  if (file) upload.mutate(file);
                }}
              />
              Change picture
            </label>
            {user.hasAvatar && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="avatar-remove"
                disabled={uploading}
                onClick={() => setConfirmRemove(true)}
              >
                Remove picture
              </Button>
            )}
          </div>
          <p className="subtitle">JPEG, PNG, WebP or GIF, up to 10 MB.</p>
        </div>
      </div>
      <StatusLine
        testId="avatar-status"
        status={avatarError ? refusal({ message: avatarError }) : null}
      />

      <form
        id="profile-form"
        className="settings-form"
        onSubmit={form.handleSubmit(({ name }) => saveName.mutate(name.trim()))}
      >
        <div className="settings-field">
          <label htmlFor="display-name">Display name</label>
          <input
            type="text"
            id="display-name"
            data-testid="display-name-input"
            autoComplete="nickname"
            maxLength={64}
            placeholder={user.name}
            {...form.register("name", { onChange: () => setStatus(null) })}
          />
        </div>
        <p className="subtitle">
          Shown on your journals, ratings and shelves. Leave it empty to use
          your username.
        </p>
        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={saveName.isPending || !changed}
            aria-busy={saveName.isPending}
            data-testid="display-name-save"
          >
            <BusyLabel
              busy={saveName.isPending}
              label="Save display name"
              busyLabel="Saving…"
            />
          </Button>
        </div>
      </form>
      <StatusLine testId="profile-status" status={status} />

      {confirmRemove && (
        <ConfirmDialog
          testId="avatar-remove-dialog"
          title="Remove your profile picture?"
          body="Other readers will see your initials instead."
          action="Remove picture"
          busyLabel="Removing…"
          busy={remove.isPending}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </section>
  );
}
