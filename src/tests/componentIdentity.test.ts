import { beforeEach, vi } from "vitest";
import { enrichDefinitions } from "~/figma/mcp/enrich";
import { componentSourceIdentity } from "~/figma/mcp/componentMap";
import type { RichComponentMeta } from "~/figma/mcp/types";
import type { PendingVectorWriteInput } from "~/figma/reducer/flush";
import type { ComponentSet, MCPResponse, V3Node } from "~/figma/types";
import { httpClient } from "~/utils/httpClient";

vi.mock("~/utils/httpClient", () => ({ httpClient: vi.fn() }));

const AUTH_HEADERS = { "X-Figma-Token": "fixture-token" };
const SET_NAME = "Button";

function meta(file: string, nodeId: string, setId = "set:1"): RichComponentMeta {
  return {
    key: `${file}-${nodeId}`,
    file_key: file,
    node_id: nodeId,
    componentSetId: setId,
    name: `State=${nodeId}`,
  };
}

function responseFor(ids: string[]): MCPResponse {
  return {
    schema: "v3",
    root: {
      type: "FRAME",
      children: ids.map((id) => ({ type: "INSTANCE", component: id, name: id })),
    },
    definitions: Object.fromEntries(ids.map((id) => [id, { name: id }])),
  };
}

function sourceNode(nodeId: string, label: string) {
  return {
    document: {
      id: nodeId,
      type: "COMPONENT",
      name: label,
      children: [{ id: `${nodeId}-text`, type: "TEXT", name: label, characters: label }],
    },
    components: {},
    componentSets: {},
  };
}

function stubLibraries(libraries: Record<string, Record<string, unknown>>) {
  vi.mocked(httpClient).mockImplementation(async (url, options) => {
    expect(options?.headers).toEqual(AUTH_HEADERS);
    const file = new URL(url).pathname.split("/")[3];
    return { nodes: libraries[file] ?? {} };
  });
}

function effectiveChildren(set: ComponentSet, id: string): V3Node[] | undefined {
  return set.variants[id].children ?? set.base?.children;
}

function standaloneMeta(file: string, nodeId: string, name: string): RichComponentMeta {
  return { ...meta(file, nodeId), componentSetId: undefined, name };
}

function sourceWithInstance(
  nodeId: string,
  componentId: string,
  components: Record<string, unknown> = {},
  children: Record<string, unknown>[] = [],
) {
  return {
    document: {
      id: nodeId,
      type: "COMPONENT",
      name: "Source",
      children: [
        { id: `${nodeId}/nested`, type: "INSTANCE", name: "Nested", componentId, children },
      ],
    },
    components,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("Component source and set identity", () => {
  it("fetches a used component by source node ID when its local ID differs", async () => {
    const response = responseFor(["local:1"]);
    stubLibraries({ "library-a": { "source:1": sourceNode("source:1", "Library label") } });
    const metadata = {
      "local:1": { ...meta("library-a", "source:1"), componentSetId: undefined, name: "Card" },
    };
    await enrichDefinitions(response, metadata, {}, AUTH_HEADERS, null);
    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/files/library-a/nodes?ids=source:1"),
      expect.anything(),
    );
    expect(effectiveChildren(response.componentSets!.Card, "local:1")?.[0].text).toBe(
      "Library label",
    );
  });

  it("does not overwrite equal source node IDs or merge equal set IDs across distinct files", async () => {
    const response = responseFor(["10:1", "local:2"]);
    stubLibraries({
      "library-a": { "10:1": sourceNode("10:1", "Library A") },
      "library-b": { "10:1": sourceNode("10:1", "Library B") },
    });
    const metadata = { "10:1": meta("library-a", "10:1"), "local:2": meta("library-b", "10:1") };
    await enrichDefinitions(
      response,
      metadata,
      { "set:1": { name: SET_NAME } },
      AUTH_HEADERS,
      null,
    );
    const [first, second] = response.root.children!;
    expect(first.component).not.toBe(second.component);
    const sets = response.componentSets!;
    expect(Object.keys(sets)).toHaveLength(2);
    expect(effectiveChildren(sets[first.component!], "10:1")?.[0].text).toBe("Library A");
    expect(effectiveChildren(sets[second.component!], "local:2")?.[0].text).toBe("Library B");
    expect(Object.keys(sets[first.component!].variants)).toEqual(["10:1"]);
    expect(Object.keys(sets[second.component!].variants)).toEqual(["local:2"]);
  });

  it("keeps unrelated same-name sets within one file separate and disambiguates names deterministically", async () => {
    const metadata = {
      "10:1": meta("library-a", "10:1", "set:a"),
      "20:1": meta("library-a", "20:1", "set:b"),
    };
    const setMetadata = { "set:a": { name: SET_NAME }, "set:b": { name: SET_NAME } };
    stubLibraries({
      "library-a": { "10:1": sourceNode("10:1", "A"), "20:1": sourceNode("20:1", "B") },
    });
    const first = responseFor(["10:1", "20:1"]);
    const reversed = responseFor(["20:1", "10:1"]);
    await enrichDefinitions(first, metadata, setMetadata, AUTH_HEADERS, null);
    await enrichDefinitions(reversed, metadata, setMetadata, AUTH_HEADERS, null);
    expect(Object.keys(first.componentSets!)).toHaveLength(2);
    expect(first.root.children![0].component).toBe(reversed.root.children![1].component);
    expect(first.root.children![1].component).toBe(reversed.root.children![0].component);
    expect(Object.values(first.componentSets!).every((set) => set.name.startsWith(SET_NAME))).toBe(
      true,
    );
  });

  it("does not merge same-name standalone components when their source identities differ", async () => {
    const response = responseFor(["first", "second"]);
    const metadata: Record<string, RichComponentMeta> = {
      first: { ...meta("library-a", "10:1"), name: "Icon", componentSetId: undefined },
      second: { ...meta("library-b", "10:1"), name: "Icon", componentSetId: undefined },
    };
    stubLibraries({
      "library-a": { "10:1": sourceNode("10:1", "A") },
      "library-b": { "10:1": sourceNode("10:1", "B") },
    });
    await enrichDefinitions(response, metadata, {}, AUTH_HEADERS, null);
    expect(Object.keys(response.componentSets!)).toHaveLength(2);
    expect(response.root.children![0].component).not.toBe(response.root.children![1].component);
  });

  it("does not pull sibling variants from a different library with the same set ID", async () => {
    const response = responseFor(["a:1"]);
    const metadata = {
      "a:1": meta("library-a", "a:1"),
      "a:2": meta("library-a", "a:2"),
      "b:1": meta("library-b", "b:1"),
    };
    stubLibraries({
      "library-a": { "a:1": sourceNode("a:1", "A1"), "a:2": sourceNode("a:2", "A2") },
      "library-b": { "b:1": sourceNode("b:1", "B1") },
    });
    await enrichDefinitions(
      response,
      metadata,
      { "set:1": { name: SET_NAME } },
      AUTH_HEADERS,
      null,
    );
    expect(Object.keys(response.componentSets![SET_NAME].variants).sort()).toEqual(["a:1", "a:2"]);
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it("preserves usable instance children when optional source nodes are unavailable", async () => {
    const response = responseFor(["local:1"]);
    response.root.children![0].children = [{ type: "TEXT", text: "Usable local label" }];
    response.root.children![0].layout = { gap: 8 };
    response.root.children![0].style = { background: "blue" };
    vi.mocked(httpClient).mockRejectedValue(new Error("Library unavailable"));
    await enrichDefinitions(
      response,
      { "local:1": meta("library-a", "local:1") },
      { "set:1": { name: SET_NAME } },
      AUTH_HEADERS,
      null,
    );
    const set = response.componentSets![SET_NAME];
    expect(effectiveChildren(set, "local:1")).toEqual([
      { type: "TEXT", text: "Usable local label" },
    ]);
    expect(set.base?.layout).toEqual({ gap: 8 });
    expect(set.base?.style).toEqual({ background: "blue" });
    expect(response.root.children![0].children![0].text).toBe("Usable local label");
  });

  it("threads request-owned pending vectors through source component reduction", async () => {
    const response = responseFor(["local:1"]);
    const pendingVectors: PendingVectorWriteInput[] = [];
    stubLibraries({
      "library-a": {
        "source:1": {
          document: {
            id: "source:1",
            type: "COMPONENT",
            name: "Icon",
            children: [
              {
                id: "vector:1",
                type: "VECTOR",
                name: "Path",
                fillGeometry: [{ path: "M0 0L8 0L8 8Z" }],
              },
            ],
          },
        },
      },
    });
    await enrichDefinitions(
      response,
      { "local:1": meta("library-a", "source:1") },
      { "set:1": { name: SET_NAME } },
      AUTH_HEADERS,
      null,
      pendingVectors,
    );
    expect(pendingVectors).toHaveLength(1);
    expect(pendingVectors[0]).toMatchObject({ fileKey: "library-a", nodeId: "vector:1" });
    expect(pendingVectors[0].target).toBe(
      effectiveChildren(response.componentSets![SET_NAME], "local:1")?.[0],
    );
  });
});

describe("Nested source component references", () => {
  it("patches a source definition's shared children to an already emitted target name", async () => {
    const response = responseFor(["localButton", "localIcon"]);
    const metadata = {
      localButton: standaloneMeta("library-a", "source:1", "Button"),
      localIcon: standaloneMeta("library-a", "source:2", "Icon"),
    };
    stubLibraries({
      "library-a": {
        "source:1": sourceWithInstance("source:1", "source:2"),
        "source:2": sourceNode("source:2", "Icon label"),
      },
    });
    await enrichDefinitions(response, metadata, {}, AUTH_HEADERS, null);
    expect(response.root.children!.map((node) => node.component)).toEqual(["Button", "Icon"]);
    expect(response.componentSets!.Button.base?.children?.[0].component).toBe("Icon");
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it("patches every variant override's children, not only shared base children", async () => {
    const response = responseFor(["localButton", "localIconA", "localIconB"]);
    const metadata = {
      localButton: meta("library-a", "button:1"),
      siblingButton: meta("library-a", "button:2"),
      localIconA: standaloneMeta("library-a", "icon:1", "Icon A"),
      localIconB: standaloneMeta("library-a", "icon:2", "Icon B"),
    };
    stubLibraries({
      "library-a": {
        "button:1": sourceWithInstance("button:1", "icon:1"),
        "button:2": sourceWithInstance("button:2", "icon:2"),
        "icon:1": sourceNode("icon:1", "A"),
        "icon:2": sourceNode("icon:2", "B"),
      },
    });
    await enrichDefinitions(
      response,
      metadata,
      { "set:1": { name: SET_NAME } },
      AUTH_HEADERS,
      null,
    );
    const set = response.componentSets![SET_NAME];
    expect(set.base?.children).toBeUndefined();
    expect(set.variants.localButton.children?.[0].component).toBe("Icon A");
    expect(set.variants.siblingButton.children?.[0].component).toBe("Icon B");
  });

  it("keeps nested references scoped when local IDs, source IDs and target display names collide across files", async () => {
    const response = responseFor(["localButtonA", "localButtonB", "localIconA", "source:2"]);
    const metadata = {
      localButtonA: standaloneMeta("library-a", "source:1", "Button A"),
      localButtonB: standaloneMeta("library-b", "source:1", "Button B"),
      localIconA: standaloneMeta("library-a", "source:2", "Icon"),
      "source:2": standaloneMeta("library-b", "source:2", "Icon"),
    };
    stubLibraries({
      "library-a": {
        "source:1": sourceWithInstance("source:1", "source:2"),
        "source:2": sourceNode("source:2", "A"),
      },
      "library-b": {
        "source:1": sourceWithInstance("source:1", "source:2"),
        "source:2": sourceNode("source:2", "B"),
      },
    });
    await enrichDefinitions(response, metadata, {}, AUTH_HEADERS, null);
    const [, , iconA, iconB] = response.root.children!;
    expect(iconA.component).not.toBe(iconB.component);
    expect(response.componentSets!["Button A"].base?.children?.[0].component).toBe(iconA.component);
    expect(response.componentSets!["Button B"].base?.children?.[0].component).toBe(iconB.component);
    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it("uses available published-key provenance for a nested imported component with a different local ID", async () => {
    const response = responseFor(["localButton", "localIcon"]);
    const metadata = {
      localButton: standaloneMeta("library-a", "button:1", "Button"),
      localIcon: standaloneMeta("library-b", "icon:2", "Icon"),
    };
    stubLibraries({
      "library-a": {
        "button:1": sourceWithInstance("button:1", "imported:9", {
          "imported:9": { key: metadata.localIcon.key, name: "Icon", remote: true },
        }),
      },
      "library-b": { "icon:2": sourceNode("icon:2", "Remote icon") },
    });
    await enrichDefinitions(response, metadata, {}, AUTH_HEADERS, null);
    expect(response.componentSets!.Button.base?.children?.[0].component).toBe("Icon");
    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it("preserves qualified unknown references and usable inline data instead of linking an equal ID in another file", async () => {
    const response = responseFor(["localButton", "unknown:2"]);
    const metadata = {
      localButton: standaloneMeta("library-a", "button:1", "Button"),
      "unknown:2": standaloneMeta("library-b", "other:2", "Unrelated icon"),
    };
    stubLibraries({
      "library-a": {
        "button:1": sourceWithInstance("button:1", "unknown:2", {}, [
          {
            id: "fallback:text",
            type: "TEXT",
            name: "Fallback",
            characters: "Usable inline label",
          },
        ]),
      },
      "library-b": { "other:2": sourceNode("other:2", "Unrelated") },
    });
    await enrichDefinitions(response, metadata, {}, AUTH_HEADERS, null);
    const nested = response.componentSets!.Button.base?.children?.[0];
    expect(nested?.component).toBe(
      componentSourceIdentity({ file_key: "library-a", node_id: "unknown:2" }),
    );
    expect(nested?.component).not.toBe(response.root.children![1].component);
    expect(nested?.children?.[0].text).toBe("Usable inline label");
    expect(httpClient).toHaveBeenCalledTimes(2);
  });
});
