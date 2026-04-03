// Re-export server-related functionality for users who want MCP server capabilities
export { createServer } from "./mcp/index";
export type { FigmaService } from "./services/figma";
export { getServerConfig } from "./config";
export { startServer, startHttpServer, stopHttpServer } from "./server";
