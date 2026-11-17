/**
 * One leading emoji, kept whole: a base pictographic, an optional variation selector or skin-tone modifier, then any
 * ZWJ-joined pictographics (families, professions). D22 allows one emoji as a category icon.
 */
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)/u;

/**
 * Splits a Money Manager category name into its leading emoji (the icon) and the rest (the name), as design §2.2 asks.
 * A name without a leading emoji keeps its whole text and a null icon. Surrounding whitespace is trimmed.
 */
export const splitLeadingEmoji = (raw: string): { icon: string | null; name: string } => {
  const trimmed = raw.trim();
  const match = trimmed.match(LEADING_EMOJI);
  if (!match) return { icon: null, name: trimmed };
  return { icon: match[1]!, name: trimmed.slice(match[1]!.length).trim() };
};
