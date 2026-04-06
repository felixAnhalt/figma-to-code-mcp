const SVG_URI_SCHEME = "figma://vector/";

export const svgContentCache = new Map<string, string>();

export function getSvgContentFromCache(key: string): string | undefined {
  return svgContentCache.get(key);
}

export function getSvgCacheSize(): number {
  return svgContentCache.size;
}

export function getCachedSvgKeys(): string[] {
  return Array.from(svgContentCache.keys());
}

export interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SvgPathEntry = {
  paths: Array<{ d: string; fillRule?: string; fillColor?: string }>;
  transform?: [number, number, number, number, number, number];
};

export { SVG_URI_SCHEME };
