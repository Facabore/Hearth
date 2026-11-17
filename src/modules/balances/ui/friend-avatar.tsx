"use client";

import { initialsOf } from "./friends";
import type { NetState } from "./net-state";

/** The tone of each direction: what is owed to the viewer in the accent, what she owes in the warm --owe ink. */
export const FRIEND_TONE: Record<NetState, string> = {
  owed: "text-accent",
  owes: "text-owe-ink",
  settled: "text-muted",
};

/** A person's initials in their round tint: warm when the viewer owes them, as the board draws Jhon López. */
export function FriendAvatar({
  name,
  state,
  size = 44,
}: {
  readonly name: string;
  readonly state: NetState;
  readonly size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-sm font-semibold ${state === "owes" ? "bg-owe-soft text-owe-ink" : "bg-accent-soft text-accent"}`}
    >
      {initialsOf(name)}
    </span>
  );
}
