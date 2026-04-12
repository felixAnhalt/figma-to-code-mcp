import type { MCPResponse } from "../../types";
import { transformToPlain } from "./plain";
import { transformToTailwind } from "./tailwind";

export function transformToDialect(response: MCPResponse, dialect: string): MCPResponse {
  switch (dialect) {
    case "plain":
    case undefined:
      return transformToPlain(response);
    case "tailwind":
      return transformToTailwind(response);
    default:
      return response;
  }
}
