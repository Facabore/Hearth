import { describe, expect, it } from "vitest";
import {
  catalogFiles,
  checkAreaReads,
  checkCatalogFiles,
  functionReads,
  keysOf,
  spaSources,
  translationReads,
} from "../../scripts/i18n-check.mjs";

const openapi = { paths: {} };
const codes = { errors: { InternalError: "x", Unknown: "x" } };

describe("i18n:check over the core catalog and its areas (ruling P276)", () => {
  it("names a key one language of an area lacks, a key in two files, and an error code no file holds", () => {
    expect(
      checkCatalogFiles({
        openapi,
        files: [
          {
            name: "core",
            es: { ...codes, common: { save: "Guardar" } },
            en: { ...codes, common: { save: "Save" } },
          },
          {
            name: "areas/plan",
            es: { reports: { title: "Plan" }, common: { save: "Guardar" } },
            en: { common: { save: "Save" } },
          },
        ],
      }),
    ).toEqual(["In two files, core and areas/plan: common.save", "Missing in areas/plan.en: reports.title"]);
    expect(
      checkCatalogFiles({
        openapi,
        files: [
          { name: "core", es: {}, en: {} },
          {
            name: "areas/plan",
            es: { errors: { InternalError: "x" } },
            en: { errors: { InternalError: "x" } },
          },
        ],
      }),
    ).toEqual(["Missing in es: errors.Unknown", "Missing in en: errors.Unknown"]);
  });

  it("reads a translator's keys: literals, a template's prefix, both branches, and a whole namespace it cannot tell", () => {
    const source = `
      const t = useTranslations("reports.lines");
      t("title"); t.rich("note", {}); t(\`state.\${state}\`); t(open ? "hide" : "show"); t(key);
      useTranslations("settings")("title");`;
    expect(translationReads(source)).toEqual([
      { path: "settings.title", prefix: false },
      { path: "reports.lines.title", prefix: false },
      { path: "reports.lines.note", prefix: false },
      { path: "reports.lines.state.", prefix: true },
      { path: "reports.lines.hide", prefix: false },
      { path: "reports.lines.show", prefix: false },
      { path: "reports.lines.", prefix: true },
    ]);
  });

  it("follows a translator handed to a function to the keys that function reads with it", () => {
    const helper = `export const memberLabel = (member: Pick<M, "a" | "b">, me: string, t: T): string =>
      member.id === me ? t("you", { name: member.name }) : \`\${member.name} \${t("guestSuffix")}\`;`;
    const sources = new Map([["src/label.ts", helper]]);
    const source = `const names = useTranslations("members"); memberLabel(member, me, names);`;
    expect(translationReads(source, functionReads(sources))).toEqual([
      { path: "members.you", prefix: false },
      { path: "members.guestSuffix", prefix: false },
    ]);
  });

  it("fails when the shell or another area's screen reads an area's key, and passes the area's own screens", () => {
    const sources = new Map([
      ["src/spa/main.tsx", `import { Shell } from "./shell";`],
      [
        "src/spa/shell.tsx",
        `export function Shell() { const t = useTranslations("members"); return t("you"); }`,
      ],
      [
        "src/spa/routes.tsx",
        `const membersRoute = createRoute({
  staticData: { areas: ["members"] },
  component: lazyRouteComponent(() => import("./routes/members"), "MembersRoute"),
});
const homeRoute = createRoute({
  component: lazyRouteComponent(() => import("./routes/home"), "Home"),
});`,
      ],
      ["src/spa/routes/members.tsx", `const t = useTranslations("members"); t("created"); t("you");`],
      ["src/spa/routes/home.tsx", `const t = useTranslations("members"); t("created");`],
    ]);
    expect(checkAreaReads({ sources, areaKeys: { members: ["members.created", "members.you"] } })).toEqual([
      "src/spa/routes/home.tsx reads the members area's members.created outside its routes: move them to the core catalog",
      "src/spa/shell.tsx reads the members area's members.you outside its routes: move them to the core catalog",
    ]);
    expect(checkAreaReads({ sources, areaKeys: { members: ["members.joined"] } })).toEqual([]);
  });

  it("passes the app's own catalogs and screens", () => {
    const files = catalogFiles();
    expect(files.map((file) => file.name)).toEqual([
      "core",
      "areas/accounts",
      "areas/categories",
      "areas/invitation",
      "areas/members",
      "areas/plan",
      "areas/recurrences",
      "areas/settings",
      "areas/trust",
    ]);
    const areaKeys = Object.fromEntries(
      files.flatMap((file) => (file.area ? [[file.area, keysOf(file.es)] as const] : [])),
    );
    expect(checkAreaReads({ sources: spaSources(), areaKeys })).toEqual([]);
  });
});
