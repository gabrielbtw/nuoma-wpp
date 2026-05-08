import { describe, expect, it } from "vitest";

import {
  OCTO_ATLAS_HEIGHT,
  OCTO_ATLAS_WIDTH,
  getOctoBackgroundPosition,
  getOctoFrameIndex,
  getOctoSpriteStyle,
} from "./sprite.js";

describe("Octo sprite atlas", () => {
  it("uses the Codex-compatible atlas dimensions", () => {
    expect(OCTO_ATLAS_WIDTH).toBe(1536);
    expect(OCTO_ATLAS_HEIGHT).toBe(1872);
  });

  it("calculates atlas background positions", () => {
    expect(getOctoBackgroundPosition(5, 7)).toBe("-1344px -1040px");
  });

  it("selects frames by row durations", () => {
    expect(getOctoFrameIndex(0, [100, 100, 200])).toBe(0);
    expect(getOctoFrameIndex(120, [100, 100, 200])).toBe(1);
    expect(getOctoFrameIndex(260, [100, 100, 200])).toBe(2);
    expect(getOctoFrameIndex(420, [100, 100, 200])).toBe(0);
  });

  it("returns background style for a visual state", () => {
    expect(getOctoSpriteStyle("review", 0)).toEqual({
      backgroundPosition: "0px -1664px",
      backgroundSize: "1536px 1872px",
    });
  });
});
