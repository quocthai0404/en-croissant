import { createStore } from "jotai/vanilla";
import { describe, expect, test } from "vitest";
import {
  currentAdvancedDrawerOpenAtom,
  currentAdvancedPanelAtom,
  currentTabSelectedAtom,
} from "@/state/atoms";

describe("Review-first Analysis navigation defaults", () => {
  test("opens a new game in Analysis and keeps Advanced tools closed until requested", () => {
    const store = createStore();

    expect(store.get(currentTabSelectedAtom)).toBe("analysis");
    expect(store.get(currentAdvancedDrawerOpenAtom)).toBe(false);
    expect(store.get(currentAdvancedPanelAtom)).toBe("engines");
  });
});
