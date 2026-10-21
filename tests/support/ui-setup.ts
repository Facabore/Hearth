import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no ResizeObserver; radix measures its hidden form inputs (Switch, RadioGroup inside a <form>) with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// findBy* and waitFor give up after 1 s by default; on a loaded machine a lazy sheet or a failed request can take longer.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => cleanup());
