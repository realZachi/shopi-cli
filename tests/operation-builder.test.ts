import { describe, expect, test } from "bun:test";
import { buildOperation } from "../src/operation-builder";
import type { IntrospectionSchema } from "../src/schema";

const schema: IntrospectionSchema = {
  queryType: { name: "QueryRoot" },
  mutationType: { name: "Mutation" },
  types: [
    {
      kind: "OBJECT",
      name: "QueryRoot",
      fields: [
        {
          name: "products",
          description: null,
          args: [
            { name: "first", type: { kind: "SCALAR", name: "Int" } },
            { name: "query", type: { kind: "SCALAR", name: "String" } }
          ],
          type: { kind: "OBJECT", name: "ProductConnection" },
          isDeprecated: false
        }
      ]
    },
    {
      kind: "OBJECT",
      name: "Mutation",
      fields: [
        {
          name: "productCreate",
          description: null,
          args: [
            {
              name: "product",
              type: {
                kind: "NON_NULL",
                ofType: { kind: "INPUT_OBJECT", name: "ProductCreateInput" }
              }
            }
          ],
          type: { kind: "OBJECT", name: "ProductCreatePayload" },
          isDeprecated: false
        }
      ]
    },
    {
      kind: "OBJECT",
      name: "ProductConnection",
      fields: [
        {
          name: "nodes",
          args: [],
          type: {
            kind: "LIST",
            ofType: { kind: "OBJECT", name: "Product" }
          },
          isDeprecated: false
        },
        {
          name: "pageInfo",
          args: [],
          type: { kind: "OBJECT", name: "PageInfo" },
          isDeprecated: false
        }
      ]
    },
    {
      kind: "OBJECT",
      name: "Product",
      fields: [
        { name: "id", args: [], type: { kind: "SCALAR", name: "ID" }, isDeprecated: false },
        { name: "title", args: [], type: { kind: "SCALAR", name: "String" }, isDeprecated: false },
        { name: "handle", args: [], type: { kind: "SCALAR", name: "String" }, isDeprecated: false }
      ]
    },
    {
      kind: "OBJECT",
      name: "ProductCreatePayload",
      fields: [
        {
          name: "product",
          args: [],
          type: { kind: "OBJECT", name: "Product" },
          isDeprecated: false
        },
        {
          name: "userErrors",
          args: [],
          type: {
            kind: "LIST",
            ofType: { kind: "OBJECT", name: "UserError" }
          },
          isDeprecated: false
        }
      ]
    },
    {
      kind: "OBJECT",
      name: "UserError",
      fields: [
        {
          name: "field",
          args: [],
          type: {
            kind: "LIST",
            ofType: { kind: "SCALAR", name: "String" }
          },
          isDeprecated: false
        },
        {
          name: "message",
          args: [],
          type: { kind: "SCALAR", name: "String" },
          isDeprecated: false
        }
      ]
    },
    {
      kind: "OBJECT",
      name: "PageInfo",
      fields: [
        {
          name: "hasNextPage",
          args: [],
          type: { kind: "SCALAR", name: "Boolean" },
          isDeprecated: false
        },
        {
          name: "endCursor",
          args: [],
          type: { kind: "SCALAR", name: "String" },
          isDeprecated: false
        }
      ]
    },
    { kind: "INPUT_OBJECT", name: "ProductCreateInput", inputFields: [] },
    { kind: "SCALAR", name: "ID" },
    { kind: "SCALAR", name: "Int" },
    { kind: "SCALAR", name: "String" },
    { kind: "SCALAR", name: "Boolean" }
  ]
};

describe("buildOperation", () => {
  test("builds a query root field", () => {
    const built = buildOperation({
      schema,
      kind: "query",
      fieldName: "products",
      args: { first: 10 }
    });

    expect(built.query).toContain("query ShopiReadProducts($first: Int)");
    expect(built.query).toContain("products(first: $first)");
    expect(built.query).toContain("nodes");
    expect(built.variables).toEqual({ first: 10 });
  });

  test("builds a mutation root field with user errors", () => {
    const built = buildOperation({
      schema,
      kind: "mutation",
      fieldName: "productCreate",
      args: { product: { title: "Desk" } }
    });

    expect(built.query).toContain(
      "mutation ShopiWriteProductCreate($product: ProductCreateInput!)"
    );
    expect(built.query).toContain("productCreate(product: $product)");
    expect(built.query).toContain("userErrors { field message }");
  });

  test("rejects missing required args", () => {
    expect(() =>
      buildOperation({
        schema,
        kind: "mutation",
        fieldName: "productCreate",
        args: {}
      })
    ).toThrow("Missing required argument");
  });
});
