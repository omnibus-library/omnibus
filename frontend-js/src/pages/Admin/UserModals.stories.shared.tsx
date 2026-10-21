import type { Meta } from "@storybook/react-vite";
import {
  aWireAdminUser,
  aWireAdminUsers,
  aWireDevice,
  type Revoked,
  sessionsHandlers,
  type UserWrites,
  usersHandlers,
} from "../../testing/adminHandlers";
import { aWireAuthSession } from "../../testing/wire";
import type { UsersCard } from "./UsersCard";

// Shared by the two UserModals story files; the name keeps it out of the `*.stories.tsx` glob.

export const ALICE = aWireAdminUser({ locked: true });
export const writes: UserWrites = {
  unlocked: [],
  created: [],
  permissions: [],
  passwords: [],
  deleted: [],
};
export const revoked: Revoked = { sessions: [], devices: [] };
export const calls = { closed: 0, done: 0 };
export const reads = { users: 0, me: 0 };

/** Every write recorder emptied, every count zeroed, and the accounts with their sessions served. */
export const resetUserModals: NonNullable<
  Meta<typeof UsersCard>["beforeEach"]
> = ({ msw }) => {
  for (const list of Object.values(writes)) list.length = 0;
  revoked.sessions.length = 0;
  revoked.devices.length = 0;
  calls.closed = 0;
  calls.done = 0;
  reads.users = 0;
  reads.me = 0;
  msw.use(
    ...usersHandlers(aWireAdminUsers(), writes),
    ...sessionsHandlers(
      {
        sessions: [
          aWireAuthSession(),
          aWireAuthSession({ id: 5, client: "Kobo Clara", device_id: 4 }),
        ],
        devices: [aWireDevice()],
      },
      { revoked },
    ),
  );
};

export const close = () => {
  calls.closed += 1;
};
