import axe from "axe-core";

/**
 * The axe-core violations under `root`, as "<rule>: <targets>". jsdom computes no layout, so contrast is left to the
 * e2e scans in a real browser (light and dark); components render outside landmarks here, so `region` is off too.
 */
export const axeViolations = async (root: Element): Promise<string[]> => {
  const result = await axe.run(root, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
};
