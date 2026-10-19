import { useState, useSyncExternalStore } from "react";
import { avatarUrl, type User, watchAvatarBusts } from "../../api";
import { initialsFor } from "../../format";

type UserAvatarProps = {
  user: Pick<User, "id" | "name" | "hasAvatar">;
  className: string;
  /** Spelled out at each site so the Atrium extractor finds the photo rule. */
  photoClassName: string;
};

/** The reader's photo, or their initials when there is none or it fails. */
export function UserAvatar({
  user,
  className,
  photoClassName,
}: UserAvatarProps) {
  // A replaced photo keeps its URL bar the bump, so a bump redraws the image.
  const src = useSyncExternalStore(watchAvatarBusts, () => avatarUrl(user.id));
  // The address that failed, so a newer one gets its own try.
  const [broken, setBroken] = useState<string | null>(null);
  const photo = user.hasAvatar && broken !== src;
  return (
    <span className={className} aria-hidden={photo ? undefined : true}>
      {photo ? (
        <img
          className={photoClassName}
          src={src}
          alt={user.name}
          onError={() => setBroken(src)}
        />
      ) : (
        initialsFor(user.name)
      )}
    </span>
  );
}
