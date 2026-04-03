import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
console.log("StdioServerTransport:", typeof StdioServerTransport);
console.log("SSEServerTransport:", typeof SSEServerTransport);
console.log("isInitializeRequest:", typeof isInitializeRequest);
