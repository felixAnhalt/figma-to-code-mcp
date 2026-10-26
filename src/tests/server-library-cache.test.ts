import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";
import { vi } from "vitest";
import { createServer } from "~/mcp";
import * as figmaFetch from "~/figma/fetch";
import { writeLibraryCache } from "~/figma/libraryCache";
import type { VariableResolutionContext } from "~/figma/variableResolver";

const AUTH = { figmaApiKey: "first-private-token", figmaOAuthToken: "", useOAuth: false };
const LIBRARY_KEYS = ["library"];
const VARIABLE_RESPONSE: GetLocalVariablesResponse = {
  status: 200,
  error: false,
  meta: {
    variableCollections: {},
    variables: {
      v: {
        id: "v",
        name: "token",
        key: "key",
        variableCollectionId: "collection",
        resolvedType: "FLOAT",
        valuesByMode: {},
        remote: false,
        description: "",
        hiddenFromPublishing: false,
        scopes: [],
        codeSyntax: {},
      },
    },
  },
};
let cachePath: string;

beforeEach(() => {
  cachePath = mkdtempSync(join(tmpdir(), "figma-server-cache-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(cachePath, { recursive: true, force: true });
});

function options() {
  return {
    libraryFileKeys: LIBRARY_KEYS,
    libraryCacheOptions: { cachePath, ttlMs: 60_000, forceRefresh: false },
  };
}

describe("server prefetch cache credential isolation", () => {
  it("never reuses an unscoped legacy cache in server preparation", async () => {
    const context: VariableResolutionContext = {
      variableValues: new Map([["private", "another-account"]]),
      variableNames: new Map(),
      activeModes: new Map(),
    };
    writeLibraryCache(context, LIBRARY_KEYS, options().libraryCacheOptions);
    const fetchVariables = vi
      .spyOn(figmaFetch, "fetchVariables")
      .mockResolvedValue(VARIABLE_RESPONSE);
    await (await createServer(AUTH, options())).close();
    expect(fetchVariables).toHaveBeenCalledTimes(1);
  });

  it("reuses only the same credential's cache, without persisting raw credentials", async () => {
    const fetchVariables = vi
      .spyOn(figmaFetch, "fetchVariables")
      .mockResolvedValue(VARIABLE_RESPONSE);
    await (await createServer(AUTH, options())).close();
    await (await createServer(AUTH, options())).close();
    expect(fetchVariables).toHaveBeenCalledTimes(1);
    const otherAuth = { ...AUTH, figmaApiKey: "second-private-token" };
    await (await createServer(otherAuth, options())).close();
    expect(fetchVariables).toHaveBeenCalledTimes(2);
    await (await createServer(AUTH, options())).close();
    expect(fetchVariables).toHaveBeenCalledTimes(2);
    const contents = readdirSync(cachePath)
      .map((name) => name + readFileSync(join(cachePath, name), "utf8"))
      .join("");
    expect(contents).not.toContain(AUTH.figmaApiKey);
    expect(contents).not.toContain(otherAuth.figmaApiKey);
  });

  it("does not share PAT and OAuth cache entries even when token text matches", async () => {
    const fetchVariables = vi
      .spyOn(figmaFetch, "fetchVariables")
      .mockResolvedValue(VARIABLE_RESPONSE);
    await (await createServer(AUTH, options())).close();
    await (
      await createServer({ ...AUTH, useOAuth: true, figmaOAuthToken: AUTH.figmaApiKey }, options())
    ).close();
    expect(fetchVariables).toHaveBeenCalledTimes(2);
  });
});
