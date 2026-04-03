import type {
  GetFileResponse,
  GetFileNodesResponse,
  GetImageFillsResponse,
  GetLocalVariablesResponse,
} from "@figma/rest-api-spec";
import { Logger, writeLogs } from "~/utils/logger.js";
import { fetchWithRetry } from "~/utils/fetch-with-retry.js";

export type FigmaAuthOptions = {
  figmaApiKey: string;
  figmaOAuthToken: string;
  useOAuth: boolean;
};

export class FigmaService {
  private readonly apiKey: string;
  private readonly oauthToken: string;
  private readonly useOAuth: boolean;
  private readonly baseUrl = "https://api.figma.com/v1";

  constructor({ figmaApiKey, figmaOAuthToken, useOAuth }: FigmaAuthOptions) {
    this.apiKey = figmaApiKey || "";
    this.oauthToken = figmaOAuthToken || "";
    this.useOAuth = !!useOAuth && !!this.oauthToken;
  }

  /** Returns the raw token string used for authentication. */
  getToken(): string {
    return this.useOAuth ? this.oauthToken : this.apiKey;
  }

  getAuthHeaders(): Record<string, string> {
    if (this.useOAuth) {
      Logger.log("Using OAuth Bearer token for authentication");
      return { Authorization: `Bearer ${this.oauthToken}` };
    } else {
      Logger.log("Using Personal Access Token for authentication");
      return { "X-Figma-Token": this.apiKey };
    }
  }

  private async request<T>(endpoint: string): Promise<T> {
    try {
      Logger.log(`Calling ${this.baseUrl}${endpoint}`);
      const headers = this.getAuthHeaders();

      return await fetchWithRetry<T & { status?: number }>(`${this.baseUrl}${endpoint}`, {
        headers,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to make request to Figma API endpoint '${endpoint}': ${errorMessage}`,
      );
    }
  }

  /**
   * Gets download URLs for all image fills in a file.
   *
   * @returns Map of imageRef to download URL
   */
  async getImageFillUrls(fileKey: string): Promise<Record<string, string>> {
    const endpoint = `/files/${fileKey}/images`;
    const response = await this.request<GetImageFillsResponse>(endpoint);
    return response.meta.images || {};
  }

  /**
   * Renders specified nodes as images and returns their download URLs.
   *
   * Note: The returned map may contain null values, indicating that rendering
   * failed for those specific nodes (e.g., node doesn't exist, is invisible, or has 0% opacity).
   * All requested node IDs are guaranteed to be in the map, whether or not rendering succeeded.
   *
   * @param fileKey - The Figma file key
   * @param nodeIds - Array of node IDs to render (e.g., ["1:2", "1:3", "1:4"])
   * @returns Map of node ID to rendered image URL (or null if render failed)
   */
  async renderNodeImages(
    fileKey: string,
    nodeIds: string[],
  ): Promise<Record<string, string | null>> {
    const idsParam = nodeIds.join(",");
    const endpoint = `/images/${fileKey}?ids=${idsParam}`;
    Logger.log(`Rendering node images from ${fileKey}: ${idsParam}`);

    interface RenderImagesResponse {
      images: Record<string, string | null>;
      err?: string;
      status?: number;
    }

    const response = await this.request<RenderImagesResponse>(endpoint);
    return response.images || {};
  }

  /**
   * Get raw Figma API response for a file (for use with flexible extractors)
   */
  async getRawFile(fileKey: string, depth?: number | null): Promise<GetFileResponse> {
    const endpoint = `/files/${fileKey}${depth ? `?depth=${depth}` : ""}`;
    Logger.log(`Retrieving raw Figma file: ${fileKey} (depth: ${depth ?? "default"})`);

    const response = await this.request<GetFileResponse>(endpoint);
    writeLogs("figma-raw.json", response);

    return response;
  }

  /**
   * Get raw Figma API response for specific nodes (for use with flexible extractors)
   */
  async getRawNode(
    fileKey: string,
    nodeId: string,
    depth?: number | null,
  ): Promise<GetFileNodesResponse> {
    const endpoint = `/files/${fileKey}/nodes?ids=${nodeId}${depth ? `&depth=${depth}` : ""}`;
    Logger.log(
      `Retrieving raw Figma node: ${nodeId} from ${fileKey} (depth: ${depth ?? "default"})`,
    );

    const response = await this.request<GetFileNodesResponse>(endpoint);
    writeLogs("figma-raw.json", response);

    return response;
  }

  /**
   * Get local variables from a Figma file.
   *
   * Returns all variables and variable collections defined in the file.
   * Used to resolve VariableAlias references (e.g., { type: "VARIABLE_ALIAS", id: "..." })
   * to actual values.
   *
   * @param fileKey - The Figma file key
   * @returns Variables and variable collections with values by mode
   */
  async getLocalVariables(fileKey: string): Promise<GetLocalVariablesResponse> {
    const endpoint = `/files/${fileKey}/variables/local`;
    Logger.log(`Retrieving local variables from ${fileKey}`);

    const response = await this.request<GetLocalVariablesResponse>(endpoint);
    writeLogs("figma-variables.json", response);

    return response;
  }
}
