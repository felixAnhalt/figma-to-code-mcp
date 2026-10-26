import { beforeEach, vi } from "vitest";
import { buildRichComponentMap } from "~/figma/mcp/componentMap";
import { enrichDefinitions } from "~/figma/mcp/enrich";
import type { MCPResponse } from "~/figma/types";
import { httpClient, httpClientRaw } from "~/utils/httpClient";

vi.mock("~/utils/httpClient", () => ({ httpClientRaw: vi.fn(), httpClient: vi.fn() }));

const AUTH_HEADERS = { "X-Figma-Token": "fixture-token" };
const API_ROOT = "https://api.figma.com/v1";

function publishedComponent(key: string, file: string, nodeId: string, setId?: string) {
  return {
    key,
    file_key: file,
    node_id: nodeId,
    name: `State=${key}`,
    description: `${file} description`,
    ...(setId
      ? { containing_frame: { containingComponentSet: { nodeId: setId, name: "Button" } } }
      : {}),
  };
}

function stubRoutes(routes: Record<string, unknown | Error | Response>) {
  vi.mocked(httpClientRaw).mockImplementation(async (url, options) => {
    expect(options?.headers).toEqual(AUTH_HEADERS);
    const route = routes[url.replace(API_ROOT, "")];
    if (route instanceof Error) throw route;
    if (route instanceof Response) return route;
    return Response.json(route ?? {}, { status: route ? 200 : 404 });
  });
}

beforeEach(() => vi.resetAllMocks());

describe("Component discovery at the HTTP boundary", () => {
  it("points unpublished local components at this file and leaves unowned remote ones without a file", async () => {
    stubRoutes({});
    const { componentMap } = await buildRichComponentMap(
      {
        local: { key: "local-key", name: "Local", remote: false },
        unknown: { key: "unknown-key", name: "Unknown" },
      },
      {},
      AUTH_HEADERS,
      "designFile",
    );
    expect(componentMap.local).toMatchObject({ file_key: "designFile", node_id: "local" });
    expect(componentMap.unknown).toMatchObject({ file_key: "", node_id: "unknown" });
  });

  it("resolves every referenced library and deduplicates repeated component keys and library requests", async () => {
    const first = publishedComponent("first", "library-a", "10:1");
    const second = publishedComponent("second", "library-a", "10:2");
    const third = publishedComponent("third", "library-b", "10:1");
    stubRoutes({
      "/components/first": { meta: first },
      "/components/second": { meta: second },
      "/components/third": { meta: third },
      "/files/library-a/components": { meta: { components: [first, second] } },
      "/files/library-b/components": { meta: { components: [third] } },
    });
    const { componentMap } = await buildRichComponentMap(
      {
        localFirst: { key: "first", name: "First" },
        localDuplicate: { key: "first", name: "First duplicate" },
        localSecond: { key: "second", name: "Second" },
        localThird: { key: "third", name: "Third" },
      },
      {},
      AUTH_HEADERS,
    );
    expect(componentMap.localThird).toMatchObject({ file_key: "library-b", node_id: "10:1" });
    expect(componentMap.localFirst).toMatchObject({ file_key: "library-a", node_id: "10:1" });
    expect(componentMap.localDuplicate.name).toBe("First duplicate");
    expect(
      vi
        .mocked(httpClientRaw)
        .mock.calls.map(([url]) => url)
        .sort(),
    ).toEqual(
      [
        "/components/first",
        "/components/third",
        "/files/library-a/components",
        "/files/library-b/components",
      ]
        .map((path) => API_ROOT + path)
        .sort(),
    );
  });

  it("resolves a local component from this file's own published listing without a lookup", async () => {
    const own = publishedComponent("own-key", "designFile", "5:5");
    stubRoutes({ "/files/designFile/components": { meta: { components: [own] } } });
    const { componentMap } = await buildRichComponentMap(
      { local: { key: "own-key", name: "Own", remote: false } },
      {},
      AUTH_HEADERS,
      "designFile",
    );
    expect(componentMap.local).toMatchObject({ file_key: "designFile", node_id: "5:5" });
    expect(httpClientRaw).toHaveBeenCalledTimes(1);
  });

  it("does not look up unpublished local components that this file's listing does not contain", async () => {
    stubRoutes({ "/files/designFile/components": { meta: { components: [] } } });
    await buildRichComponentMap(
      { local: { key: "unpublished-key", name: "Unpublished", remote: false } },
      {},
      AUTH_HEADERS,
      "designFile",
    );
    expect(vi.mocked(httpClientRaw).mock.calls.map(([url]) => url)).toEqual([
      `${API_ROOT}/files/designFile/components`,
    ]);
  });

  it("does not stop provenance discovery after three unavailable component keys", async () => {
    const available = publishedComponent("available", "library-b", "20:1");
    stubRoutes({
      "/components/available": { meta: available },
      "/files/library-b/components": { meta: { components: [available] } },
    });
    const raw = Object.fromEntries(
      ["missing-1", "missing-2", "missing-3", "available"].map((key) => [key, { key, name: key }]),
    );
    const { componentMap } = await buildRichComponentMap(raw, {}, AUTH_HEADERS);
    expect(componentMap.available).toMatchObject({ file_key: "library-b", node_id: "20:1" });
    expect(componentMap["missing-1"].name).toBe("missing-1");
  });

  it("uses directly resolved source metadata when optional library listing is unavailable", async () => {
    const source = publishedComponent("direct", "library-a", "source:7");
    stubRoutes({ "/components/direct": { meta: source } });
    const { componentMap } = await buildRichComponentMap(
      { local: { key: "direct", name: "Local name" } },
      {},
      AUTH_HEADERS,
    );
    expect(componentMap.local).toMatchObject({
      file_key: "library-a",
      node_id: "source:7",
      name: "Local name",
    });
  });

  it("keeps unavailable and unpublished metadata as usable local fallbacks without resolving empty keys", async () => {
    stubRoutes({});
    const { componentMap } = await buildRichComponentMap(
      {
        unavailable: { key: "missing", name: "Unavailable", componentSetId: "local-set" },
        unpublished: { key: "", name: "Unpublished", remote: false },
      },
      { "local-set": { name: "Local set" } },
      AUTH_HEADERS,
    );
    expect(componentMap.unavailable).toMatchObject({
      name: "Unavailable",
      componentSetId: "local-set",
    });
    expect(componentMap.unpublished).toMatchObject({ name: "Unpublished", node_id: "unpublished" });
    expect(httpClientRaw).toHaveBeenCalledTimes(1);
  });

  it("isolates transport failures per optional provenance instead of rejecting the design", async () => {
    const available = publishedComponent("available", "library-b", "20:1");
    stubRoutes({
      "/components/broken": new Error("Offline metadata"),
      "/components/available": { meta: available },
      "/files/library-b/components": { meta: { components: [available] } },
    });
    const result = await buildRichComponentMap(
      {
        broken: { key: "broken", name: "Broken" },
        available: { key: "available", name: "Available" },
      },
      {},
      AUTH_HEADERS,
    );
    expect(result.componentMap.broken.name).toBe("Broken");
    expect(result.componentMap.available.file_key).toBe("library-b");
  });

  it("maps local set IDs to source identities and discovers sibling variants from each referenced library", async () => {
    const first = publishedComponent("first", "library-a", "10:1", "source-set");
    const sibling = publishedComponent("sibling", "library-a", "10:2", "source-set");
    const unrelated = publishedComponent("unrelated", "library-a", "10:3", "other-set");
    stubRoutes({
      "/components/first": { meta: first },
      "/files/library-a/components": { meta: { components: [first, sibling, unrelated] } },
    });
    const result = await buildRichComponentMap(
      {
        local: { key: "first", name: "State=First", componentSetId: "local-set" },
      },
      { "local-set": { name: "Button" } },
      AUTH_HEADERS,
    );
    expect(result.componentMap.local.componentSetId).toBe("source-set");
    expect(
      Object.values(result.componentMap).filter((meta) => meta.key === "sibling"),
    ).toHaveLength(1);
    expect(Object.values(result.componentMap).some((meta) => meta.key === "unrelated")).toBe(false);
    expect(Object.values(result.componentSetMap).some((set) => set.name === "Button")).toBe(true);
  });

  it("preserves raw set metadata when there are no components to resolve", async () => {
    stubRoutes({});
    expect(await buildRichComponentMap({}, { set: { name: "Button" } }, AUTH_HEADERS)).toEqual({
      componentMap: {},
      componentSetMap: { set: { name: "Button" } },
    });
    expect(httpClientRaw).not.toHaveBeenCalled();
  });

  it("does not mistake a local ID for a source ID when optional metadata is incomplete", async () => {
    stubRoutes({ "/components/incomplete": { meta: { file_key: "library-a" } } });
    const { componentMap } = await buildRichComponentMap(
      { local: { key: "incomplete", name: "Local fallback" } },
      {},
      AUTH_HEADERS,
    );
    expect(componentMap.local).toMatchObject({
      name: "Local fallback",
      node_id: "local",
      file_key: "",
    });
  });

  it("enriches discovered sources from two files using their distinct set metadata", async () => {
    const first = publishedComponent("first", "library-a", "10:1", "set:1");
    const second = publishedComponent("second", "library-b", "10:1", "set:1");
    first.containing_frame!.containingComponentSet.name = "Library A Button";
    second.containing_frame!.containingComponentSet.name = "Library B Button";
    stubRoutes({
      "/components/first": { meta: first },
      "/components/second": { meta: second },
      "/files/library-a/components": { meta: { components: [first] } },
      "/files/library-b/components": { meta: { components: [second] } },
    });
    const { componentMap, componentSetMap } = await buildRichComponentMap(
      {
        localA: { key: "first", name: "State=First", componentSetId: "local:a" },
        localB: { key: "second", name: "State=Second", componentSetId: "local:b" },
      },
      {},
      AUTH_HEADERS,
    );
    vi.mocked(httpClient).mockImplementation(async (url) => {
      const file = new URL(url).pathname.split("/")[3];
      return {
        nodes: {
          "10:1": {
            document: {
              id: "10:1",
              type: "COMPONENT",
              name: file,
              children: [{ id: "10:2", type: "TEXT", name: file, characters: file }],
            },
          },
        },
      };
    });
    const response: MCPResponse = {
      schema: "v3",
      root: {
        type: "FRAME",
        children: [
          { type: "INSTANCE", component: "localA" },
          { type: "INSTANCE", component: "localB" },
        ],
      },
      definitions: { localA: { name: "A" }, localB: { name: "B" } },
    };
    await enrichDefinitions(response, componentMap, componentSetMap, AUTH_HEADERS, null);
    expect(response.root.children!.map((node) => node.component)).toEqual([
      "Library A Button",
      "Library B Button",
    ]);
    expect(response.componentSets!["Library A Button"].base?.children?.[0].text).toBe("library-a");
    expect(response.componentSets!["Library B Button"].base?.children?.[0].text).toBe("library-b");
  });
});
