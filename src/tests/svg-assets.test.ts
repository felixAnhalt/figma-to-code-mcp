import { setImmediate } from "node:timers/promises";
import { vi } from "vitest";
import { materializeSvgAssets } from "~/figma/svg/assets";
import * as writer from "~/figma/svg/writer";

afterEach(() => vi.restoreAllMocks());

it("settles all asset writes before reporting a partial materialization failure", async () => {
  let finishWrite!: (filename: string) => void;
  const unfinishedWrite = new Promise<string>((resolve) => {
    finishWrite = resolve;
  });
  vi.spyOn(writer, "writeVectorSvgToDisk")
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(unfinishedWrite);
  let settled = false;
  const result = materializeSvgAssets(
    [
      { fileKey: "file", nodeId: "1:1", content: "<svg/>" },
      { fileKey: "file", nodeId: "1:2", content: "<svg/>" },
    ],
    "destination",
  ).catch((error: unknown) => {
    settled = true;
    return error;
  });
  try {
    await setImmediate();
    expect(settled).toBe(false);
  } finally {
    finishWrite("file_1_2.svg");
    await result;
  }
  expect(await result).toBeInstanceOf(Error);
});
