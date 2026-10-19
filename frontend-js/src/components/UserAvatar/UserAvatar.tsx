import { useState } from "react";
import { avatarUrl, type User } from "../../api";
import { initialsFor } from "../../format";

type UserAvatarProps = {
  user: User;
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
  const [broken, setBroken] = useState(false);
  const photo = user.hasAvatar && !broken;
  return (
    <span className={className} aria-hidden={photo ? undefined : true}>
      {photo ? (
        <img
          className={photoClassName}
          src={avatarUrl(user.id)}
          alt={user.name}
          onError={() => setBroken(true)}
        />
      ) : (
        initialsFor(user.name)
      )}
    </span>
  );
}
