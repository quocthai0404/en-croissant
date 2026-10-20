import { describe, expect, test } from "vitest";
import { getReviewBoardContextId, resolveReviewBoardOrientation } from "./orientation";

describe("Game Review board orientation", () => {
  test("Auto puts the identified player at the bottom, including Black", () => {
    expect(resolveReviewBoardOrientation("auto", "black")).toBe("black");
    expect(resolveReviewBoardOrientation("auto", "white")).toBe("white");
  });

  test("manual orientation overrides Auto and Neutral safely uses the fallback", () => {
    expect(resolveReviewBoardOrientation("white", "black")).toBe("white");
    expect(resolveReviewBoardOrientation("black", "white")).toBe("black");
    expect(resolveReviewBoardOrientation("auto", "neutral", "black")).toBe("black");
  });

  test("context changes produce a different per-tab preference scope", () => {
    const headers = { white: "Thaidev", black: "Rofu1", date: "2026.10.20", event: "Live" };
    const first = getReviewBoardContextId("tab-1", "root", headers, ["e2e4"]);
    expect(getReviewBoardContextId("tab-1", "root", headers, ["d2d4"])).not.toBe(first);
    expect(getReviewBoardContextId("tab-2", "root", headers, ["e2e4"])).not.toBe(first);
  });
});
