import { describe, expect, test } from "bun:test";
import { formatMarkdown, formatTable } from "../src/output";

describe("output formatting", () => {
  test("formats connection nodes as a table", () => {
    const table = formatTable({
      products: {
        nodes: [
          { id: "gid://shopify/Product/1", title: "Desk" },
          { id: "gid://shopify/Product/2", title: "Chair" }
        ]
      }
    });

    expect(table).toContain("id");
    expect(table).toContain("Desk");
    expect(table).toContain("Chair");
  });

  test("formats markdown tables", () => {
    const markdown = formatMarkdown([{ name: "default", shop: "demo.myshopify.com" }]);

    expect(markdown).toContain("| name | shop |");
    expect(markdown).toContain("| default | demo.myshopify.com |");
  });
});
