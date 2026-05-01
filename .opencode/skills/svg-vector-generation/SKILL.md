---
name: svg-vector-generation
description: SVG vector generation from Figma VECTOR nodes — caching, path merging, bounds calculation, and disk writing.
---

## What I do

I know the SVG vector generation pipeline in `src/figma/svg/`.

## Pipeline

### Cache (`cache.ts`)

- `svgContentCache` — in-memory `Map<string, string>` storing SVG content by key
- `SVG_URI_SCHEME` = `"figma://vector/"` — URI format for `read_vector_svg` tool
- Types: `SvgBounds` (x, y, width, height), `SvgPathEntry` (d, fill, stroke, opacity, ...)

### Transform (`transform.ts`)

- `computePathBounds()` — bounds for individual paths
- `buildSvgContent()` — generates SVG from Figma vector network + fills
- `buildSvgContentFromEntries()` — generates SVG from precomputed path entries
- `roundPathCoordinates()` — path precision rounding

### Writer (`writer.ts`)

- `writeVectorSvg()` — caches SVG content in memory
- `resolveVectorUri()` — parses `figma://vector/{key}` → cached SVG
- `writeVectorSvgToDisk()` — writes single vector SVG to disk
- `writeMergedVectorSvgToDisk()` — merges multiple VECTOR nodes into one SVG file

### Merge (`merge.ts`)

- Merges multiple VECTOR node geometries into a single SVG
- Handles multi-path output, bounds calculation, stroke + dash

### Flush (`src/figma/reducer/flush.ts`)

- `flushAllPendingVectorSvgs()` — writes all pending SVGs from the reducer pass to disk
- Called during `generateMCPResponse()` pipeline

## Key files

- `src/figma/svg/cache.ts`
- `src/figma/svg/transform.ts`
- `src/figma/svg/writer.ts`
- `src/figma/svg/merge.ts`
- `src/figma/reducer/flush.ts`

## When to use me

Use this when:

- Debugging SVG output issues
- Adding new SVG features (gradients, text, etc.)
- Understanding the `figma://vector/` URI scheme
- Modifying the SVG cache or write pipeline
