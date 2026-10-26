import { execFile } from "node:child_process";

const CURL_BINARY = "curl";
const CURL_TIMEOUT_MS = 30000;
const CURL_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const STATUS_TRAILER_FORMAT = "\\n%{http_code}";
const STATUS_LINE_SEPARATOR = "\n";
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

export type CurlRunner = (args: string[], stdinConfig: string) => Promise<string>;

export function supportsCurlFallback(options: RequestInit): boolean {
  return (options.method ?? "GET").toUpperCase() === "GET";
}

/**
 * Runs curl with the request read from stdin as a config, so the token never
 * appears in the process argument list.
 */
export function runCurlProcess(args: string[], stdinConfig: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CURL_BINARY,
      args,
      { timeout: CURL_TIMEOUT_MS, maxBuffer: CURL_MAX_BUFFER_BYTES },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.end(stdinConfig);
  });
}

/**
 * Sends a GET request through curl and returns it as a Response, so callers handle the
 * status and body exactly as they do for fetch. Response headers are not available.
 */
export async function fetchViaCurl(
  url: string,
  options: RequestInit,
  runCurl: CurlRunner = runCurlProcess,
): Promise<Response> {
  if (!supportsCurlFallback(options)) {
    throw new Error(`curl fallback only supports GET requests, got ${options.method}`);
  }
  const args = ["-s", "-S", "-L", "-K", "-", "-w", STATUS_TRAILER_FORMAT];
  const output = await runCurl(args, curlConfig(url, options.headers));
  const separator = output.lastIndexOf(STATUS_LINE_SEPARATOR);
  const status = Number(output.slice(separator + 1));
  if (separator < 0 || !isHttpStatus(status)) {
    throw new Error(`curl returned no HTTP status for ${url}`);
  }
  return new Response(output.slice(0, separator), { status });
}

function curlConfig(url: string, headers: HeadersInit | undefined): string {
  const lines = [`url = ${quoteConfigValue(url)}`];
  for (const [key, value] of headerEntries(headers)) {
    lines.push(`header = ${quoteConfigValue(`${key}: ${value}`)}`);
  }
  return `${lines.join("\n")}\n`;
}

function headerEntries(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) {
    const entries: Array<[string, string]> = [];
    headers.forEach((value, key) => entries.push([key, value]));
    return entries;
  }
  if (Array.isArray(headers)) return headers as Array<[string, string]>;
  return Object.entries(headers);
}

function quoteConfigValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isHttpStatus(status: number): boolean {
  return Number.isInteger(status) && status >= MIN_HTTP_STATUS && status <= MAX_HTTP_STATUS;
}
