import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";

interface CategoryDto {
  id: string;
  groupId: string;
  name: string;
  key: string | null;
  archivedAt: string | null;
}
interface GroupDto {
  id: string;
  name: string;
  archivedAt: string | null;
  categories: CategoryDto[];
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const treeOf = (user: TestUser | undefined, spaceId: string, query = "") =>
  call(listCategories, "GET", `/api/v1/spaces/${spaceId}/categories${query}`, { user, params: { spaceId } });
const groupsIn = async (response: Response) => ((await response.json()) as { items: GroupDto[] }).items;

describe("default categories (HU-E3-01)", () => {
  it("seeds the Spanish tree into the personal space at sign-up", async () => {
    const ana = await registerUser("Ana");
    const response = await treeOf(ana, ana.spaceId);
    expect(response.status).toBe(200);
    const groups = await groupsIn(response);
    const names = (group: string) => groups.find((g) => g.name === group)?.categories.map((c) => c.name);
    expect(names("Vivienda")).toEqual(["Arriendo", "Mantenimiento", "Servicios"]);
    expect(names("Ingresos")).toEqual(["Otros ingresos", "Salario"]);
    expect(groups.flatMap((g) => g.categories)).toContainEqual(
      expect.objectContaining({ name: "Mercado", key: "groceries", archivedAt: null }),
    );
  });

  it("hides another user's space and malformed ids as SpaceNotFound (Review Focus 4)", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    for (const spaceId of [ana.spaceId, "not-a-uuid"]) {
      const response = await treeOf(juan, spaceId);
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("SpaceNotFound");
    }
  });

  it("requires authentication", async () => {
    const ana = await registerUser("Ana");
    expect((await treeOf(undefined, ana.spaceId)).status).toBe(401);
  });
});
