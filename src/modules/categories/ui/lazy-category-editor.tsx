import dynamic from "next/dynamic";

/**
 * Ruling P346 (S6): «Editar categoría» opens from the record form's pencil, so it loads when the pencil is first
 * tapped, in a chunk of its own: the record and edit routes never carry the sheet, its pickers or its icon library
 * (ADR 0004).
 */
export const LazyCategoryEditor = dynamic(
  () => import("./category-editor").then((module) => module.CategoryEditor),
  { ssr: false },
);
