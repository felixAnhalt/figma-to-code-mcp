import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { generateMCPResponse } from "~/figma/mcp";
import type { MCPOptions } from "~/figma/mcp/types";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import * as cache from "~/figma/cache";
import { fetchNodesBatch } from "~/figma/batchFetch";
import { fetchVariables } from "~/figma/fetch";
import { downloadBytes } from "~/utils/downloadBytes";

vi.mock("~/figma/batchFetch", () => ({ fetchNodesBatch: vi.fn() }));
vi.mock("~/figma/fetch", () => ({
  fetchVariables: vi.fn(async () => null),
  fetchComments: vi.fn(async () => []),
}));
vi.mock("~/utils/downloadBytes", () => ({ downloadBytes: vi.fn(async () => Buffer.from("png")) }));

let sequence = 0;
let directory: string;

function options(overrides: Partial<MCPOptions> = {}): MCPOptions {
  return {
    fileKey: `cacheRequest${++sequence}`,
    rootNodeId: "1:1",
    authHeaders: { "X-Figma-Token": "first-secret" },
    resolveVariables: false,
    ...overrides,
  };
}

function entry(document: Record<string, unknown>) {
  return { document, components: {}, componentSets: {}, styles: {} };
}

function root(overrides: Record<string, unknown> = {}) {
  return entry({ id: "1:1", type: "FRAME", name: "Root", ...overrides });
}

function vector(id: string = "1:1", path: string = "M0 0L10 0L10 10Z") {
  return {
    id,
    type: "VECTOR",
    name: "Icon",
    fillGeometry: [{ path, windingRule: "NONZERO" }],
  };
}

function respond(document: ReturnType<typeof root> = root()) {
  vi.mocked(fetchNodesBatch).mockResolvedValue({ "1:1": document } as Awaited<
    ReturnType<typeof fetchNodesBatch>
  >);
}

function context(
  value: number = 8,
  name: string = "space.small",
  mode: string = "light",
): VariableResolutionContext {
  return {
    variableValues: new Map([["gap", value]]),
    variableNames: new Map([["gap", name]]),
    activeModes: new Map([["collection", mode]]),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "figma-design-cache-"));
  respond();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("design cache input isolation", () => {
  it("does not reuse unresolved results when variable resolution is enabled", async () => {
    respond(
      root({
        fills: [
          {
            type: "SOLID",
            color: { r: 1, g: 0, b: 0, a: 1 },
            boundVariables: { color: { type: "VARIABLE_ALIAS", id: "paint" } },
          },
        ],
      }),
    );
    const preloaded = context();
    preloaded.variableValues.set("paint", { r: 0, g: 0, b: 1, a: 1 });
    const opts = options({ preloadedVariableContext: preloaded });
    const unresolved = await generateMCPResponse(opts);
    const resolved = await generateMCPResponse({ ...opts, resolveVariables: true });
    expect(unresolved.root.style?.background).toBe("#FF0000");
    expect(resolved.root.style?.background).toBe("#0000FF");
    expect(fetchVariables).toHaveBeenCalledOnce();
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
  });

  it("isolates credentials without putting secrets in cache keys", async () => {
    const setCache = vi.spyOn(cache, "setCache");
    const opts = options();
    await generateMCPResponse(opts);
    await generateMCPResponse({ ...opts, authHeaders: { Authorization: "Bearer second-secret" } });
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(setCache.mock.calls.map(([key]) => key))).not.toMatch(/secret/);
  });

  it.each([
    ["values", context(12)],
    ["names", context(8, "space.other")],
    ["modes", context(8, "space.small", "dark")],
  ])("includes preloaded variable %s in cache identity", async (_label, changedContext) => {
    const opts = options({ resolveVariables: true, preloadedVariableContext: context() });
    await generateMCPResponse(opts);
    await generateMCPResponse({ ...opts, preloadedVariableContext: changedContext });
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
  });

  it("includes explicit metadata in cache identity", async () => {
    const opts = options({ componentMap: {}, componentSetMap: {} });
    await generateMCPResponse(opts);
    await generateMCPResponse({ ...opts, componentSetMap: { set: { name: "Changed" } } });
    await generateMCPResponse({ ...opts, styleMap: { style: { name: "Changed" } } });
    await generateMCPResponse({ ...opts, componentMap: undefined });
    expect(fetchNodesBatch).toHaveBeenCalledTimes(4);
  });

  it("keeps the component-variant option in cache identity without splitting the default", async () => {
    const opts = options({ componentMap: {}, componentSetMap: {} });
    await generateMCPResponse(opts);
    await generateMCPResponse({ ...opts, includeComponentVariants: true });
    await generateMCPResponse({ ...opts, includeComponentVariants: false });
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
  });

  it("normalizes record and Map order for compatible cache hits", async () => {
    const first = context();
    first.variableValues.set("other", 16);
    const second = { ...first, variableValues: new Map([...first.variableValues].reverse()) };
    const opts = options({
      resolveVariables: true,
      preloadedVariableContext: first,
      authHeaders: { "X-Figma-Token": "secret", Accept: "application/json" },
    });
    await generateMCPResponse(opts);
    await generateMCPResponse({
      ...opts,
      preloadedVariableContext: second,
      authHeaders: { Accept: "application/json", "X-Figma-Token": "secret" },
    });
    expect(fetchNodesBatch).toHaveBeenCalledOnce();
  });

  it("does not expose the stored response to caller mutation", async () => {
    const opts = options();
    const first = await generateMCPResponse(opts);
    first.root.name = "Caller mutation";
    const second = await generateMCPResponse(opts);
    expect(second.root.name).toBe("Root");
    expect(first).not.toBe(second);
    expect(fetchNodesBatch).toHaveBeenCalledOnce();
  });

  it("bypasses existing cache entries when cacheTTL is zero", async () => {
    const opts = options();
    await generateMCPResponse(opts);
    await generateMCPResponse({ ...opts, cacheTTL: 0 });
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
  });

  it("does not store requests with a nonpositive cacheTTL", async () => {
    const opts = options({ cacheTTL: -1 });
    await generateMCPResponse(opts);
    await generateMCPResponse({ ...opts, cacheTTL: 60_000 });
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
  });
});

describe("cached SVG materialization", () => {
  it("exports cached assets into each requested directory without refetching", async () => {
    respond(entry(vector()));
    const opts = options({ svgOutputDir: join(directory, "first") });
    const first = await generateMCPResponse(opts);
    const secondDir = join(directory, "second");
    const second = await generateMCPResponse({ ...opts, svgOutputDir: secondDir });
    const filename = `${opts.fileKey}_1_1.svg`;
    expect(second.svgAssetsFolder).toBe(secondDir);
    expect(first.svgAssetsFolder).toBe(opts.svgOutputDir);
    expect(await readFile(join(secondDir, filename), "utf8")).toContain("<svg");
    expect(fetchNodesBatch).toHaveBeenCalledOnce();
  });

  it("keeps asset content in the design artifact rather than a mutable global SVG cache", async () => {
    const opts = options({ svgOutputDir: join(directory, "first") });
    respond(entry(vector("1:1", "M0 0L10 0L10 10Z")));
    await generateMCPResponse(opts);
    respond(entry(vector("1:1", "M0 0L99 0L99 99Z")));
    await generateMCPResponse({ ...opts, authHeaders: { "X-Figma-Token": "other" } });
    const restored = join(directory, "restored");
    await generateMCPResponse({ ...opts, svgOutputDir: restored });
    expect(await readFile(join(restored, `${opts.fileKey}_1_1.svg`), "utf8")).toContain("10");
    expect(await readFile(join(restored, `${opts.fileKey}_1_1.svg`), "utf8")).not.toContain("99");
  });

  it("reports failed asset writes rather than returning a nonexistent asset directory", async () => {
    respond(entry(vector()));
    const blocked = join(directory, "not-a-directory");
    await writeFile(blocked, "occupied");
    await expect(generateMCPResponse(options({ svgOutputDir: blocked }))).rejects.toThrow(
      /SVG|asset/i,
    );
  });
});

describe("pending SVG request ownership", () => {
  it("does not flush another request's assets while enrichment is waiting", async () => {
    let release!: (value: Awaited<ReturnType<typeof fetchNodesBatch>>) => void;
    let signalWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => {
      signalWaiting = resolve;
    });
    const library = new Promise<Awaited<ReturnType<typeof fetchNodesBatch>>>((resolve) => {
      release = resolve;
    });
    const first = options({
      svgOutputDir: join(directory, "first"),
      componentMap: {
        "9:1": { key: "component", file_key: "waitingLibrary", node_id: "9:1", name: "Button" },
      },
    });
    const second = options({ svgOutputDir: join(directory, "second") });
    vi.mocked(fetchNodesBatch).mockImplementation(async (fileKey) => {
      if (fileKey === "waitingLibrary") {
        signalWaiting();
        return library;
      }
      return {
        "1:1":
          fileKey === first.fileKey
            ? root({
                children: [
                  vector("1:2"),
                  { id: "1:3", type: "INSTANCE", name: "Button", componentId: "9:1" },
                ],
              })
            : entry(vector()),
      } as Awaited<ReturnType<typeof fetchNodesBatch>>;
    });
    const firstResult = generateMCPResponse(first);
    await waiting;
    try {
      await generateMCPResponse(second);
      expect(await readdir(second.svgOutputDir!)).toEqual([`${second.fileKey}_1_1.svg`]);
    } finally {
      release({});
      await firstResult;
    }
    expect(await readdir(first.svgOutputDir!)).toEqual([`${first.fileKey}_1_2.svg`]);
  });

  it("does not carry queued assets from a failed reduction into a later request", async () => {
    const failed = options();
    respond(
      root({
        children: [
          vector("1:2"),
          {
            id: "1:3",
            type: "RECTANGLE",
            name: "Malformed",
            effects: [null],
          },
        ],
      }),
    );
    await expect(generateMCPResponse(failed)).rejects.toThrow();
    respond(entry(vector()));
    const next = options({ svgOutputDir: join(directory, "next") });
    await generateMCPResponse(next);
    expect(await readdir(next.svgOutputDir!)).toEqual([`${next.fileKey}_1_1.svg`]);
  });
});

describe("cached rendered node image", () => {
  const RENDER_URL = "https://images.example/root.png";

  it("writes the rendered PNG from cache hits without rendering again", async () => {
    const render = vi.fn(async () => RENDER_URL);
    const opts = options({ svgOutputDir: join(directory, "first"), fetchRenderedImageUrl: render });
    const first = await generateMCPResponse(opts);
    const secondDir = join(directory, "second");
    const second = await generateMCPResponse({ ...opts, svgOutputDir: secondDir });
    const filename = `${opts.fileKey}_1_1.png`;
    expect(first.renderedDesignNodeAssetsFolder).toBe(opts.svgOutputDir);
    expect(second.renderedDesignNodeAssetsFolder).toBe(secondDir);
    expect(second.renderedDesignNodePathInAssetFolder).toBe(filename);
    expect(downloadBytes).toHaveBeenCalledWith(RENDER_URL);
    expect(await readFile(join(secondDir, filename), "utf8")).toBe("png");
    expect(render).toHaveBeenCalledOnce();
    expect(fetchNodesBatch).toHaveBeenCalledOnce();
  });

  it("adds no image fields when rendering is not requested", async () => {
    const result = await generateMCPResponse(options({ svgOutputDir: directory }));
    expect(result).not.toHaveProperty("renderedDesignNodePathInAssetFolder");
  });

  it("keeps the render option in cache identity", async () => {
    const opts = options();
    await generateMCPResponse({ ...opts, fetchRenderedImageUrl: async () => RENDER_URL });
    await generateMCPResponse(opts);
    expect(fetchNodesBatch).toHaveBeenCalledTimes(2);
  });

  it("returns the design without image fields when Figma renders nothing", async () => {
    const opts = options({ svgOutputDir: directory, fetchRenderedImageUrl: async () => null });
    const result = await generateMCPResponse(opts);
    expect(result.root.name).toBe("Root");
    expect(result).not.toHaveProperty("renderedDesignNodePathInAssetFolder");
  });

  it("returns the design without image fields when the render request throws", async () => {
    const opts = options({
      svgOutputDir: directory,
      fetchRenderedImageUrl: async () => {
        throw new Error("Figma unavailable");
      },
    });
    const result = await generateMCPResponse(opts);
    expect(result.root.name).toBe("Root");
    expect(result).not.toHaveProperty("renderedDesignNodePathInAssetFolder");
  });

  it("returns the design without image fields when the download fails", async () => {
    vi.mocked(downloadBytes).mockRejectedValueOnce(new Error("expired"));
    const opts = options({
      svgOutputDir: directory,
      fetchRenderedImageUrl: async () => RENDER_URL,
    });
    const result = await generateMCPResponse(opts);
    expect(result.root.name).toBe("Root");
    expect(result).not.toHaveProperty("renderedDesignNodePathInAssetFolder");
  });
});
