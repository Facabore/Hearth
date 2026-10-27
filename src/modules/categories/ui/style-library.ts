import type { SymbolName } from "@/shared/kernel/style";
import type { CategoryDto } from "@/shared/ui/api/dto";
import { matches } from "./category-tree";

export type IconChoice = CategoryDto["icon"];
export type IconTab = IconChoice["kind"];

/**
 * HU-E3-05, HU-E9-04: the icon library's nine symbol sections, in the order and with the names the library shows. A
 * section is UI metadata only: the API receives the bare name.
 */
export const SYMBOL_SECTIONS = [
  { id: "food", names: ["cart", "bread", "cup", "fork", "apple", "wine", "pizza", "basket"] },
  { id: "home", names: ["home", "bulb", "droplet", "flame", "wifi", "wrench", "key", "sofa"] },
  { id: "transport", names: ["bus", "car", "fuel", "bike", "plane", "train", "parking"] },
  { id: "health", names: ["heart", "pill", "cross", "tooth", "gym", "scissors", "leaf"] },
  { id: "leisure", names: ["ticket", "music", "game", "tv", "book", "gift", "globe"] },
  { id: "shopping", names: ["shirt", "bag", "tag", "phone", "laptop"] },
  { id: "money", names: ["card", "bank", "piggy", "coins", "chart", "receipt", "percent"] },
  { id: "people", names: ["users", "paw", "graduation", "briefcase"] },
  { id: "other", names: ["star", "umbrella", "shield", "calendar", "dots"] },
] as const satisfies readonly { id: string; names: readonly SymbolName[] }[];

/**
 * HU-E9-04: the emoji tab's own sections. Each emoji has an id for its catalog label (`categories.emoji.<id>`); the
 * API accepts any single emoji, listed here or not.
 */
export const EMOJI_SECTIONS = [
  {
    id: "food",
    emoji: [
      ["cart", "🛒"],
      ["bread", "🍞"],
      ["coffee", "☕"],
      ["plate", "🍽️"],
      ["apple", "🍎"],
      ["pizza", "🍕"],
      ["wine", "🍷"],
      ["broccoli", "🥦"],
    ],
  },
  {
    id: "home",
    emoji: [
      ["house", "🏠"],
      ["bulb", "💡"],
      ["droplet", "💧"],
      ["fire", "🔥"],
      ["couch", "🛋️"],
      ["wrench", "🔧"],
      ["key", "🔑"],
      ["broom", "🧹"],
    ],
  },
  {
    id: "transport",
    emoji: [
      ["bus", "🚌"],
      ["car", "🚗"],
      ["fuel", "⛽"],
      ["bike", "🚲"],
      ["plane", "✈️"],
      ["train", "🚆"],
      ["taxi", "🚕"],
      ["scooter", "🛵"],
    ],
  },
  {
    id: "health",
    emoji: [
      ["heart", "❤️"],
      ["pill", "💊"],
      ["hospital", "🏥"],
      ["tooth", "🦷"],
      ["muscle", "💪"],
      ["haircut", "💇"],
      ["herb", "🌿"],
      ["soap", "🧼"],
    ],
  },
  {
    id: "leisure",
    emoji: [
      ["ticket", "🎟️"],
      ["music", "🎵"],
      ["game", "🎮"],
      ["tv", "📺"],
      ["books", "📚"],
      ["gift", "🎁"],
      ["globe", "🌍"],
      ["party", "🎉"],
    ],
  },
  {
    id: "shopping",
    emoji: [
      ["shirt", "👕"],
      ["bags", "🛍️"],
      ["label", "🏷️"],
      ["phone", "📱"],
      ["laptop", "💻"],
      ["shoe", "👟"],
      ["ring", "💍"],
      ["package", "📦"],
    ],
  },
  {
    id: "money",
    emoji: [
      ["card", "💳"],
      ["bank", "🏦"],
      ["moneyBag", "💰"],
      ["coin", "🪙"],
      ["chart", "📈"],
      ["receipt", "🧾"],
      ["banknote", "💵"],
      ["abacus", "🧮"],
    ],
  },
  {
    id: "people",
    emoji: [
      ["family", "👪"],
      ["baby", "👶"],
      ["dog", "🐶"],
      ["cat", "🐱"],
      ["graduation", "🎓"],
      ["briefcase", "💼"],
      ["handshake", "🤝"],
      ["people", "👥"],
    ],
  },
] as const satisfies readonly { id: string; emoji: readonly (readonly [string, string])[] }[];

export type LibrarySymbol = (typeof SYMBOL_SECTIONS)[number]["names"][number];
type SymbolSectionId = (typeof SYMBOL_SECTIONS)[number]["id"];
type EmojiSectionId = (typeof EMOJI_SECTIONS)[number]["id"];
export type EmojiId = (typeof EMOJI_SECTIONS)[number]["emoji"][number][0];

/** The catalog keys (under `categories`) of the library's labels and section names. */
export type LibraryKey =
  | `symbol.${LibrarySymbol}`
  | `symbolSection.${SymbolSectionId}`
  | `emoji.${EmojiId}`
  | `emojiSection.${EmojiSectionId}`;

const LIBRARY_SYMBOLS: readonly string[] = SYMBOL_SECTIONS.flatMap((section) => section.names);
const ALL_EMOJI: readonly (readonly [EmojiId, string])[] = EMOJI_SECTIONS.flatMap(
  (section): readonly (readonly [EmojiId, string])[] => section.emoji,
);

export const isLibrarySymbol = (name: string): name is LibrarySymbol => LIBRARY_SYMBOLS.includes(name);

/** The library id of an emoji, for its label; `null` for one the library does not list. */
export const emojiIdOf = (value: string): EmojiId | null =>
  ALL_EMOJI.find(([, emoji]) => emoji === value)?.[0] ?? null;

const QUICK_COUNT = 11;

/** HU-E9-04: the symbol tab's quick choices. */
export const QUICK_SYMBOLS = [
  "cart",
  "bread",
  "cup",
  "fork",
  "bus",
  "home",
  "bulb",
  "heart",
  "gift",
  "book",
  "gym",
] as const satisfies readonly SymbolName[];

/** HU-E9-04: the emoji tab's quick choices, the first 11 of the library. */
export const QUICK_EMOJI = ALL_EMOJI.slice(0, QUICK_COUNT).map(([, value]) => value);

export const isSameIcon = (a: IconChoice, b: IconChoice): boolean =>
  a.kind === "SYMBOL" ? b.kind === "SYMBOL" && a.name === b.name : b.kind === "EMOJI" && a.value === b.value;

/**
 * The 11 quick choices of a tab. A current choice of that tab outside the quick set takes the first slot (and the last
 * quick choice leaves), so it is always visible and selected.
 */
export const quickChoices = (tab: IconTab, current: IconChoice): IconChoice[] => {
  const quick: IconChoice[] =
    tab === "SYMBOL"
      ? QUICK_SYMBOLS.map((name) => ({ kind: "SYMBOL", name }))
      : QUICK_EMOJI.map((value) => ({ kind: "EMOJI", value }));
  if (current.kind !== tab || quick.some((choice) => isSameIcon(choice, current))) return quick;
  return [current, ...quick.slice(0, QUICK_COUNT - 1)];
};

/** A stable key for a choice: `SYMBOL:cart` or `EMOJI:🛒`. */
export const iconKey = (icon: IconChoice): string =>
  icon.kind === "SYMBOL" ? `SYMBOL:${icon.name}` : `EMOJI:${icon.value}`;

export interface LibraryChoice {
  readonly icon: IconChoice;
  readonly label: string;
}

export interface LibrarySection {
  readonly id: string;
  readonly name: string;
  readonly choices: readonly LibraryChoice[];
}

/** One tab of the library, its labels and section names read from the `categories` catalog by `t`. */
export const librarySections = (tab: IconTab, t: (key: LibraryKey) => string): LibrarySection[] =>
  tab === "SYMBOL"
    ? SYMBOL_SECTIONS.map((section) => ({
        id: section.id,
        name: t(`symbolSection.${section.id}`),
        choices: section.names.map((name) => ({
          icon: { kind: "SYMBOL", name },
          label: t(`symbol.${name}`),
        })),
      }))
    : EMOJI_SECTIONS.map((section) => ({
        id: section.id,
        name: t(`emojiSection.${section.id}`),
        choices: (section.emoji as readonly (readonly [EmojiId, string])[]).map(([id, value]) => ({
          icon: { kind: "EMOJI", value },
          label: t(`emoji.${id}`),
        })),
      }));

/**
 * HU-E9-04: the library search ignores case and accents and matches a choice's label or its section's name; a
 * matching section keeps all its choices, and sections left empty are dropped.
 */
export const searchLibrary = (sections: readonly LibrarySection[], query: string): LibrarySection[] => {
  if (query.trim() === "") return [...sections];
  return sections
    .map((section) =>
      matches(section.name, query)
        ? section
        : { ...section, choices: section.choices.filter((choice) => matches(choice.label, query)) },
    )
    .filter((section) => section.choices.length > 0);
};
