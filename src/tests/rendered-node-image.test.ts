import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { fetchNodesBatch } from "~/figma/batchFetch";
import { getRenderedNodeFilename, writeRenderedNodeImage } from "~/figma/renderedNodeImage";
import { getFigmaDesignTool } from "~/mcp/tools/getFigmaDesignTool";
import { FigmaService } from "~/services/figmaConnector";
import { downloadBytes } from "~/utils/downloadBytes";

vi.mock("~/figma/batchFetch", () => ({ fetchNodesBatch: vi.fn() }));
vi.mock("~/figma/fetch", () => ({
  fetchVariables: vi.fn(async () => null),
  fetchComments: vi.fn(async () => []),
}));
vi.mock("~/utils/downloadBytes", () => ({ downloadBytes: vi.fn(async () => Buffer.from("png")) }));

const RENDER_URL = "https://images.example/1-1.png";
let directory: string;

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "rendered-node-image-"));
  vi.mocked(fetchNodesBatch).mockResolvedValue({
    "1:1": {
      document: { id: "1:1", type: "FRAME", name: "Root" },
      components: {},
      componentSets: {},
      styles: {},
    },
  } as unknown as Awaited<ReturnType<typeof fetchNodesBatch>>);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("getRenderedNodeFilename", () => {
  it("names the PNG by file key and node id with unsafe characters replaced", () => {
    expect(getRenderedNodeFilename("fileKey", "1:2")).toBe("fileKey_1_2.png");
  });
});

describe("writeRenderedNodeImage", () => {
  it("writes the downloaded bytes and returns the folder and file name", async () => {
    const download = vi.fn(async () => Buffer.from("png-bytes"));
    const result = await writeRenderedNodeImage(directory, "fileKey", "1:2", RENDER_URL, download);
    expect(download).toHaveBeenCalledWith(RENDER_URL);
    expect(result).toEqual({
      renderedDesignNodeAssetsFolder: directory,
      renderedDesignNodePathInAssetFolder: "fileKey_1_2.png",
    });
    expect(await readFile(join(directory, "fileKey_1_2.png"), "utf8")).toBe("png-bytes");
  });

  it("returns undefined when the download fails", async () => {
    const download = vi.fn(async () => {
      throw new Error("expired");
    });
    expect(await writeRenderedNodeImage(directory, "fileKey", "1:2", RENDER_URL, download)).toBe(
      undefined,
    );
  });
});

describe("get_figma_design rendered node image", () => {
  function serviceWithRender(images: Record<string, string | null>) {
    const service = new FigmaService({
      figmaApiKey: "render-test",
      figmaOAuthToken: "",
      useOAuth: false,
    });
    const renderNodeImages = vi.spyOn(service, "renderNodeImages").mockResolvedValue(images);
    return { service, renderNodeImages };
  }

  it("renders the requested node through FigmaService and returns the PNG key", async () => {
    const { service, renderNodeImages } = serviceWithRender({ "1:1": RENDER_URL });
    const result = await getFigmaDesignTool.handler(
      {
        fileKey: "abc123",
        nodeId: "1:1",
        resolveVariables: false,
        includeComponentVariants: false,
      },
      service,
      { outputFormat: "json", svgOutputDir: directory, renderImage: true },
    );
    const response = JSON.parse(result.content[0].text);
    expect(renderNodeImages).toHaveBeenCalledWith("abc123", ["1:1"]);
    expect(downloadBytes).toHaveBeenCalledWith(RENDER_URL);
    expect(response.renderedDesignNodeAssetsFolder).toBe(directory);
    expect(response.renderedDesignNodePathInAssetFolder).toBe("abc123_1_1.png");
  });

  it("does not call the render endpoint when image rendering is off", async () => {
    const { service, renderNodeImages } = serviceWithRender({ "1:1": RENDER_URL });
    const result = await getFigmaDesignTool.handler(
      {
        fileKey: "abc123",
        nodeId: "1:1",
        resolveVariables: false,
        includeComponentVariants: false,
      },
      service,
      { outputFormat: "json", svgOutputDir: directory, renderImage: false },
    );
    const response = JSON.parse(result.content[0].text);
    expect(renderNodeImages).not.toHaveBeenCalled();
    expect(response).not.toHaveProperty("renderedDesignNodePathInAssetFolder");
  });
});
