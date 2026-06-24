import { describe, expect, test } from "bun:test";
import { getBooleanFlag, getFlag, getRepeatedFlag, parseArgv } from "../src/args";

describe("parseArgv", () => {
  test("parses positionals and long flags", () => {
    const parsed = parseArgv([
      "read",
      "products",
      "--first",
      "10",
      "--output=json",
      "--pretty"
    ]);

    expect(parsed.positionals).toEqual(["read", "products"]);
    expect(getFlag(parsed.flags, "first")).toBe("10");
    expect(getFlag(parsed.flags, "output")).toBe("json");
    expect(getBooleanFlag(parsed.flags, "pretty")).toBe(true);
  });

  test("collects repeated arg flags", () => {
    const parsed = parseArgv([
      "write",
      "metafieldsSet",
      "--arg",
      "metafields=@metafields.json",
      "-a",
      "ownerId=gid://shopify/Product/1"
    ]);

    expect(getRepeatedFlag(parsed.flags, "arg")).toEqual([
      "metafields=@metafields.json",
      "ownerId=gid://shopify/Product/1"
    ]);
  });
});
