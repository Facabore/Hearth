/** Ruling P189: the detail sheet is addressed by `?tx=<id>` on the page that lists the row. */
export const withTx = (href: string, id: string): string => {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("tx", id);
  return `${path}?${params.toString()}`;
};

/** The same address without the sheet: what closing it replaces the entry with. */
export const withoutTx = (href: string): string => {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.delete("tx");
  const text = params.toString();
  return text ? `${path}?${text}` : path!;
};
