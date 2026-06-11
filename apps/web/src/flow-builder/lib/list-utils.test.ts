import { describe, expect, it } from "vitest";

import { moveItem, moveItemById } from "./list-utils.js";

describe("list utils", () => {
  it("moves items by relative index without mutating the source", () => {
    const source = ["a", "b", "c"];

    expect(moveItem(source, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(source, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(source, 0, -1)).toBe(source);
    expect(source).toEqual(["a", "b", "c"]);
  });

  it("moves items by id and keeps invalid moves as no-ops", () => {
    const source = [{ id: "a" }, { id: "b" }, { id: "c" }];

    expect(moveItemById(source, "a", "c").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(moveItemById(source, "missing", "c")).toBe(source);
    expect(moveItemById(source, "a", "a")).toBe(source);
  });
});
