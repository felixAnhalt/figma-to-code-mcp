export {
  svgContentCache,
  getSvgContentFromCache,
  getSvgCacheSize,
  getCachedSvgKeys,
  SVG_URI_SCHEME,
  type SvgBounds,
  type SvgPathEntry,
} from "./cache";

export {
  computePathBounds,
  computeBoundsFromPaths,
  transformPath,
  roundPathCoordinates,
  buildSvgContent,
  buildSvgContentWithFills,
  buildSvgContentFromEntries,
} from "./transform";

export {
  writeVectorSvg,
  resolveVectorUri,
  writeVectorSvgToDisk,
  writeMergedVectorSvgToDisk,
} from "./writer";
