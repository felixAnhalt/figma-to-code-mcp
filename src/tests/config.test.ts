import { describe, it, expect } from "vitest";
import { getServerConfig } from "../config";

describe("config", () => {
  describe("defaults", () => {
    it("has expected default port", () => {
      const config = getServerConfig(true);
      expect(config.port).toBeGreaterThan(0);
    });

    it("has expected default host", () => {
      const config = getServerConfig(true);
      expect(config.host).toBe("127.0.0.1");
    });

    it("has expected default outputFormat", () => {
      const config = getServerConfig(true);
      expect(config.outputFormat).toBeDefined();
      expect(["yaml", "json"]).toContain(config.outputFormat);
    });

    it("has expected default skipImageDownloads", () => {
      const config = getServerConfig(true);
      expect(config.skipImageDownloads).toBeDefined();
      expect(typeof config.skipImageDownloads).toBe("boolean");
    });

    it("has svgOutputDir set", () => {
      const config = getServerConfig(true);
      expect(config.svgOutputDir).toBeDefined();
      expect(config.svgOutputDir.length).toBeGreaterThan(0);
    });
  });

  describe("auth structure", () => {
    it("has auth object with figmaApiKey", () => {
      const config = getServerConfig(true);
      expect(config.auth).toBeDefined();
      expect(config.auth.figmaApiKey).toBeDefined();
      expect(typeof config.auth.figmaApiKey).toBe("string");
    });

    it("has auth object with figmaOAuthToken", () => {
      const config = getServerConfig(true);
      expect(config.auth).toBeDefined();
      expect(config.auth.figmaOAuthToken).toBeDefined();
      expect(typeof config.auth.figmaOAuthToken).toBe("string");
    });

    it("has useOAuth as boolean", () => {
      const config = getServerConfig(true);
      expect(config.auth).toBeDefined();
      expect(typeof config.auth.useOAuth).toBe("boolean");
    });
  });

  describe("configSources", () => {
    it("has configSources object", () => {
      const config = getServerConfig(true);
      expect(config.configSources).toBeDefined();
    });

    it("configSources has expected shape", () => {
      const config = getServerConfig(true);
      expect(config.configSources.figmaApiKey).toBeDefined();
      expect(config.configSources.figmaOAuthToken).toBeDefined();
      expect(config.configSources.port).toBeDefined();
      expect(config.configSources.host).toBeDefined();
      expect(config.configSources.outputFormat).toBeDefined();
    });
  });
});
