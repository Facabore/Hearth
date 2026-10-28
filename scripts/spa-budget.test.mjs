import { describe, expect, it } from "vitest";
import { chunkSizes, overBudget } from "./spa-budget.mjs";

const manifest = {
  "index.html": { file: "assets/index.js", isEntry: true, imports: ["_react.js"], css: ["assets/index.css"] },
  "_react.js": { file: "assets/react.js" },
  "_link.js": { file: "assets/link.js", imports: ["_react.js"] },
  "routes/sign-in.tsx": {
    file: "assets/sign-in.js",
    isDynamicEntry: true,
    imports: ["_react.js", "_link.js"],
  },
  "routes/space.tsx": { file: "assets/space.js", isDynamicEntry: true, imports: ["_link.js"] },
};
const kb = {
  "assets/index.js": 70,
  "assets/react.js": 5,
  "assets/link.js": 10,
  "assets/sign-in.js": 2,
  "assets/space.js": 3,
};

describe("SPA chunk budgets (ADR 0006)", () => {
  it("counts the shell as the entry and its static imports, and each route as what the shell does not hold", () => {
    expect(chunkSizes(manifest, (file) => kb[file])).toEqual({
      shell: 75,
      "routes/sign-in.tsx": 12,
      "routes/space.tsx": 13,
    });
  });

  it("fails a chunk over its budget and a chunk without one", () => {
    expect(overBudget({ shell: 75, "routes/space.tsx": 13 }, { shell: 74 })).toEqual([
      "shell: 75.0 KiB is over its budget of 74 KiB",
      "routes/space.tsx: 13.0 KiB has no budget in tests/performance/spa-budgets.json",
    ]);
    expect(overBudget({ shell: 75 }, { shell: 75 })).toEqual([]);
  });
});
