import { config as loadEnv } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolve, join } from "path";
import { tmpdir } from "node:os";
import type { FigmaAuthOptions } from "./services/figma";

const DEFAULT_LIBRARY_CACHE_PATH = join(tmpdir(), "figma-mcp-library-cache.json");
const DEFAULT_LIBRARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ServerConfig {
  auth: FigmaAuthOptions;
  port: number;
  host: string;
  outputFormat: "yaml" | "json";
  skipImageDownloads?: boolean;
  svgOutputDir: string;
  libraryFileKeys: string[];
  libraryCachePath: string;
  libraryCacheTtlMs: number;
  forceRefreshLibraryCache: boolean;
  configSources: {
    figmaApiKey: "cli" | "env";
    figmaOAuthToken: "cli" | "env" | "none";
    port: "cli" | "env" | "default";
    host: "cli" | "env" | "default";
    outputFormat: "cli" | "env" | "default";
    envFile: "cli" | "default";
    skipImageDownloads?: "cli" | "env" | "default";
    svgOutputDir: "cli" | "env" | "default";
    libraryFileKeys: "cli" | "env" | "default";
    libraryCachePath: "cli" | "env" | "default";
    libraryCacheTtlMs: "env" | "default";
    forceRefreshLibraryCache: "env" | "default";
  };
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

interface CliArgs {
  "figma-api-key"?: string;
  "figma-oauth-token"?: string;
  env?: string;
  port?: number;
  host?: string;
  json?: boolean;
  "skip-image-downloads"?: boolean;
  "svg-output-dir"?: string;
  "library-file-keys"?: string;
  "library-cache-path"?: string;
}

export function getServerConfig(isStdioMode: boolean): ServerConfig {
  // Parse command line arguments
  const argv = yargs(hideBin(process.argv))
    .options({
      "figma-api-key": {
        type: "string",
        description: "Figma API key (Personal Access Token)",
      },
      "figma-oauth-token": {
        type: "string",
        description: "Figma OAuth Bearer token",
      },
      env: {
        type: "string",
        description: "Path to custom .env file to load environment variables from",
      },
      port: {
        type: "number",
        description: "Port to run the server on",
      },
      host: {
        type: "string",
        description: "Host to run the server on",
      },
      json: {
        type: "boolean",
        description: "Output data from tools in JSON format instead of YAML",
        default: false,
      },
      "skip-image-downloads": {
        type: "boolean",
        description: "Do not register image-related tools (skip image fill fetching)",
        default: false,
      },
      "svg-output-dir": {
        type: "string",
        description: "Directory to save SVG asset files (default: system temp folder)",
      },
      "library-file-keys": {
        type: "string",
        description:
          "Comma-separated Figma library file keys to prefetch variables from at startup (e.g. abc123,def456)",
      },
      "library-cache-path": {
        type: "string",
        description: "Path to the library variable cache file (default: system temp folder)",
      },
    })
    .help()
    .version(process.env.NPM_PACKAGE_VERSION ?? "unknown")
    .parseSync() as CliArgs;

  // Load environment variables ASAP from custom path or default
  let envFilePath: string;
  let envFileSource: "cli" | "default";

  if (argv["env"]) {
    envFilePath = resolve(argv["env"]);
    envFileSource = "cli";
  } else {
    envFilePath = resolve(process.cwd(), ".env");
    envFileSource = "default";
  }

  // Override anything auto-loaded from .env if a custom file is provided.
  loadEnv({ path: envFilePath, override: true });

  const auth: FigmaAuthOptions = {
    figmaApiKey: "",
    figmaOAuthToken: "",
    useOAuth: false,
  };

  const config: Omit<ServerConfig, "auth"> = {
    port: 3333,
    host: "127.0.0.1",
    outputFormat: "yaml",
    skipImageDownloads: false,
    svgOutputDir: "",
    libraryFileKeys: [],
    libraryCachePath: DEFAULT_LIBRARY_CACHE_PATH,
    libraryCacheTtlMs: DEFAULT_LIBRARY_CACHE_TTL_MS,
    forceRefreshLibraryCache: false,
    configSources: {
      figmaApiKey: "env",
      figmaOAuthToken: "none",
      port: "default",
      host: "default",
      outputFormat: "default",
      envFile: envFileSource,
      skipImageDownloads: "default",
      svgOutputDir: "default",
      libraryFileKeys: "default",
      libraryCachePath: "default",
      libraryCacheTtlMs: "default",
      forceRefreshLibraryCache: "default",
    },
  };

  // Handle FIGMA_API_KEY
  if (argv["figma-api-key"]) {
    auth.figmaApiKey = argv["figma-api-key"];
    config.configSources.figmaApiKey = "cli";
  } else if (process.env.FIGMA_API_KEY) {
    auth.figmaApiKey = process.env.FIGMA_API_KEY;
    config.configSources.figmaApiKey = "env";
  }

  // Handle FIGMA_OAUTH_TOKEN
  if (argv["figma-oauth-token"]) {
    auth.figmaOAuthToken = argv["figma-oauth-token"];
    config.configSources.figmaOAuthToken = "cli";
    auth.useOAuth = true;
  } else if (process.env.FIGMA_OAUTH_TOKEN) {
    auth.figmaOAuthToken = process.env.FIGMA_OAUTH_TOKEN;
    config.configSources.figmaOAuthToken = "env";
    auth.useOAuth = true;
  }

  // Handle PORT (FIGMA_TO_CODE_MCP_PORT takes precedence, PORT is fallback for backwards compatibility)
  if (argv.port) {
    config.port = argv.port;
    config.configSources.port = "cli";
  } else if (process.env.FIGMA_TO_CODE_MCP_PORT) {
    config.port = parseInt(process.env.FIGMA_TO_CODE_MCP_PORT, 10);
    config.configSources.port = "env";
  } else if (process.env.PORT) {
    config.port = parseInt(process.env.PORT, 10);
    config.configSources.port = "env";
  }

  // Handle HOST
  if (argv.host) {
    config.host = argv.host;
    config.configSources.host = "cli";
  } else if (process.env.FIGMA_TO_CODE_MCP_HOST) {
    config.host = process.env.FIGMA_TO_CODE_MCP_HOST;
    config.configSources.host = "env";
  }

  // Handle JSON output format
  if (argv.json) {
    config.outputFormat = "json";
    config.configSources.outputFormat = "cli";
  } else if (process.env.OUTPUT_FORMAT) {
    const raw = process.env.OUTPUT_FORMAT;
    if (raw === "yaml" || raw === "json") {
      config.outputFormat = raw;
      config.configSources.outputFormat = "env";
    } else {
      console.warn(`Unknown OUTPUT_FORMAT "${raw}", falling back to "yaml"`);
    }
  }

  // Handle skipImageDownloads
  if (argv["skip-image-downloads"]) {
    config.skipImageDownloads = true;
    config.configSources.skipImageDownloads = "cli";
  } else if (process.env.SKIP_IMAGE_DOWNLOADS === "true") {
    config.skipImageDownloads = true;
    config.configSources.skipImageDownloads = "env";
  }

  // Handle svgOutputDir (default: system temp directory)
  if (argv["svg-output-dir"]) {
    config.svgOutputDir = resolve(argv["svg-output-dir"]);
    config.configSources.svgOutputDir = "cli";
  } else if (process.env.FIGMA_SVG_OUTPUT_DIR) {
    config.svgOutputDir = resolve(process.env.FIGMA_SVG_OUTPUT_DIR);
    config.configSources.svgOutputDir = "env";
  } else {
    config.svgOutputDir = resolve(tmpdir(), "figma-mcp-svg-files");
  }

  // Handle libraryFileKeys (comma-separated Figma file keys for variable prefetch)
  if (argv["library-file-keys"]) {
    config.libraryFileKeys = argv["library-file-keys"]
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    config.configSources.libraryFileKeys = "cli";
  } else if (process.env.FIGMA_LIBRARY_VARIABLE_PREFETCH_FILE_KEYS) {
    config.libraryFileKeys = process.env.FIGMA_LIBRARY_VARIABLE_PREFETCH_FILE_KEYS.split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    config.configSources.libraryFileKeys = "env";
  }

  // Handle libraryCachePath
  if (argv["library-cache-path"]) {
    config.libraryCachePath = resolve(argv["library-cache-path"]);
    config.configSources.libraryCachePath = "cli";
  } else if (process.env.FIGMA_MCP_CACHE_PATH) {
    config.libraryCachePath = resolve(process.env.FIGMA_MCP_CACHE_PATH);
    config.configSources.libraryCachePath = "env";
  }

  // Handle libraryCacheTtlMs (FIGMA_MCP_CACHE_TTL_MS, in milliseconds)
  if (process.env.FIGMA_MCP_CACHE_TTL_MS) {
    const parsed = parseInt(process.env.FIGMA_MCP_CACHE_TTL_MS, 10);
    if (!isNaN(parsed) && parsed > 0) {
      config.libraryCacheTtlMs = parsed;
      config.configSources.libraryCacheTtlMs = "env";
    }
  }

  // Handle forceRefreshLibraryCache (presence of FIGMA_MCP_REFRESH_CACHE triggers refresh)
  if (process.env.FIGMA_MCP_REFRESH_CACHE) {
    config.forceRefreshLibraryCache = true;
    config.configSources.forceRefreshLibraryCache = "env";
  }

  // Validate configuration
  if (!auth.figmaApiKey && !auth.figmaOAuthToken) {
    console.error(
      "Either FIGMA_API_KEY or FIGMA_OAUTH_TOKEN is required (via CLI argument or .env file)",
    );
    process.exit(1);
  }

  // Log configuration sources
  if (!isStdioMode) {
    console.log("\nConfiguration:");
    console.log(`- ENV_FILE: ${envFilePath} (source: ${config.configSources.envFile})`);
    if (auth.useOAuth) {
      console.log(
        `- FIGMA_OAUTH_TOKEN: ${maskApiKey(auth.figmaOAuthToken)} (source: ${config.configSources.figmaOAuthToken})`,
      );
      console.log("- Authentication Method: OAuth Bearer Token");
    } else {
      console.log(
        `- FIGMA_API_KEY: ${maskApiKey(auth.figmaApiKey)} (source: ${config.configSources.figmaApiKey})`,
      );
      console.log("- Authentication Method: Personal Access Token (X-Figma-Token)");
    }
    console.log(`- FIGMA_TO_CODE_MCP_PORT: ${config.port} (source: ${config.configSources.port})`);
    console.log(`- FIGMA_TO_CODE_MCP_HOST: ${config.host} (source: ${config.configSources.host})`);
    console.log(
      `- OUTPUT_FORMAT: ${config.outputFormat} (source: ${config.configSources.outputFormat})`,
    );
    console.log(
      `- SKIP_IMAGE_DOWNLOADS: ${config.skipImageDownloads} (source: ${config.configSources.skipImageDownloads})`,
    );
    console.log(
      `- FIGMA_SVG_OUTPUT_DIR: ${config.svgOutputDir} (source: ${config.configSources.svgOutputDir})`,
    );
    if (config.libraryFileKeys.length > 0) {
      console.log(
        `- FIGMA_LIBRARY_VARIABLE_PREFETCH_FILE_KEYS: ${config.libraryFileKeys.join(", ")} (source: ${config.configSources.libraryFileKeys})`,
      );
      console.log(
        `- FIGMA_MCP_CACHE_PATH: ${config.libraryCachePath} (source: ${config.configSources.libraryCachePath})`,
      );
      console.log(
        `- FIGMA_MCP_CACHE_TTL_MS: ${config.libraryCacheTtlMs}ms (source: ${config.configSources.libraryCacheTtlMs})`,
      );
      if (config.forceRefreshLibraryCache) {
        console.log(`- FIGMA_MCP_REFRESH_CACHE: set — cache will be force-refreshed`);
      }
    }
    console.log(); // Empty line for better readability
  }

  return {
    ...config,
    auth,
  };
}
