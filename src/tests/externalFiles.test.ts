import { describe, expect, it } from "vitest";
import { reserveStems } from "~/figma/mcp/externalFiles";

describe("reserveStems", () => {
  it("gives every name a distinct, filesystem-safe stem", () => {
    expect(
      reserveStems(["Button", "button", "Icon / Search", "Icon - Search", "!!!"], "component-set"),
    ).toEqual(["Button", "button-2", "Icon-Search", "Icon-Search-2", "component-set"]);
  });

  it("keeps variant stems distinct when node ids sanitize to the same stem", () => {
    expect(reserveStems(["1:1", "1-1"], "variant")).toEqual(["1-1", "1-1-2"]);
  });
});
