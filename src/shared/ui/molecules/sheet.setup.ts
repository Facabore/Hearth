import { preloadSheet } from "./sheet";

// A sheet loads its panel on first open in the browser; tests open it synchronously.
await preloadSheet();
