import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import type { Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Id } from "@/shared/kernel";

export interface SpaceFixture {
  readonly userId: string;
  readonly spaceId: string;
  readonly memberId: string;
}

/** A registered user with their personal space, written through the real spaces repository. */
export const personalSpaceFixture = async (db: Database, pool: Pool, name = "Ana"): Promise<SpaceFixture> => {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const space = createPersonalSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: userId,
    ownerName: name,
    now: new Date(),
  });
  await new DrizzleSpaceRepository(new DrizzleTransactionManager(db)).add(space);
  return { userId, spaceId: space.id, memberId: space.members[0]!.id };
};
