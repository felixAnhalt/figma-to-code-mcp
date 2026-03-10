# V2 CSS Property Mapping Reference

This document details how Figma properties are mapped to CSS-aligned properties in v2.

## Philosophy

1. **Use CSS property names when possible** - Matches LLM training data
2. **Inline all styling** - No separate dictionaries
3. **Omit defaults** - Reduce token count (opacity: 1, visible: true, etc.)
4. **Preserve what's needed for UI building** - Omit internal Figma state

---

## Complete Property Mapping

### Layout Properties (Flexbox)

| Figma Property                 | CSS Property                                 | Notes                                                                           |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------- |
| `layoutMode: "HORIZONTAL"`     | `display: "flex"`, `flexDirection: "row"`    | Auto-layout → Flexbox                                                           |
| `layoutMode: "VERTICAL"`       | `display: "flex"`, `flexDirection: "column"` | Auto-layout → Flexbox                                                           |
| `counterAxisAlignItems`        | `alignItems`                                 | MIN→flex-start, MAX→flex-end, CENTER→center, BASELINE→baseline, STRETCH→stretch |
| `primaryAxisAlignItems`        | `justifyContent`                             | MIN→flex-start, MAX→flex-end, CENTER→center, SPACE_BETWEEN→space-between        |
| `itemSpacing`                  | `gap`                                        | Omitted if 0                                                                    |
| `paddingTop/Right/Bottom/Left` | `padding: { top, right, bottom, left }`      | Omitted if all 0                                                                |
| `layoutWrap: "WRAP"`           | `flexWrap: "wrap"`                           | ✨ NEW in v2                                                                    |
| `clipsContent: true`           | `overflow: "hidden"`                         | ✨ NEW in v2                                                                    |

### Sizing Properties

| Figma Property                                    | CSS Property | Notes                                |
| ------------------------------------------------- | ------------ | ------------------------------------ |
| `size.x` (when `layoutSizingHorizontal: "FIXED"`) | `width`      | ✨ NEW in v2 - Only for fixed sizing |
| `size.y` (when `layoutSizingVertical: "FIXED"`)   | `height`     | ✨ NEW in v2 - Only for fixed sizing |
| `minWidth`                                        | `minWidth`   | ✨ NEW in v2                         |
| `maxWidth`                                        | `maxWidth`   | ✨ NEW in v2                         |

**Important**: Width/height are NOT included for auto-layout sizing modes (FILL, HUG) - the layout is defined by flexbox properties instead.

### Transform Properties

| Figma Property       | CSS Property                | Notes                                             |
| -------------------- | --------------------------- | ------------------------------------------------- |
| `rotation` (radians) | `transform: "rotate(Xdeg)"` | ✨ NEW in v2 - Converted to degrees, omitted if 0 |

### Visual Styling Properties

| Figma Property                        | CSS Property                             | Notes                                                               |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `fills[0]` (SOLID)                    | `backgroundColor: "rgba(r, g, b, a)"`    | Inline color string                                                 |
| `fills[0]` (SOLID, for TEXT)          | `color: "rgba(r, g, b, a)"`              | Text color                                                          |
| `fills[0]` (GRADIENT\_\*)             | `background: [Paint]`                    | Gradient as Paint object                                            |
| `fills[0]` (IMAGE)                    | `background: [Paint]`                    | Image as Paint object                                               |
| `strokes[0]` (SOLID)                  | `border: "rgba(r, g, b, a)"`             | Border color                                                        |
| `strokeWeight`                        | `borderWidth`                            | Omitted if 0                                                        |
| `cornerRadius`                        | `borderRadius`                           | Omitted if 0                                                        |
| `rectangleCornerRadii`                | `borderRadius: [tl, tr, br, bl]`         | ✨ NEW in v2 - Individual corners, simplified to number if all same |
| `opacity`                             | `opacity`                                | Omitted if 1                                                        |
| `effects` (DROP_SHADOW, INNER_SHADOW) | `boxShadow: "Xpx Ypx Blur Spread Color"` | Multiple shadows joined with ", "                                   |
| `effects` (LAYER_BLUR)                | `filter: "blur(Xpx)"`                    | ✨ NEW in v2                                                        |

### Text Properties

| Figma Property                          | CSS Property          | Notes                                                             |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `characters`                            | `text`                | Actual text content                                               |
| `fills[0]`                              | `color`               | Text color (same as visual fills for TEXT nodes)                  |
| `style.fontFamily` or `fontName.family` | `fontFamily`          | Font name                                                         |
| `style.fontSize` or `fontSize`          | `fontSize`            | Font size in pixels                                               |
| `style.fontWeight` or `fontWeight`      | `fontWeight`          | 100-900                                                           |
| `style.fontStyle` or `fontName.style`   | `fontStyle: "italic"` | ✨ NEW in v2 - Only if contains "italic"                          |
| `style.lineHeightPx`                    | `lineHeight`          | Line height in pixels                                             |
| `style.lineHeightPercent`               | `lineHeight: "X%"`    | Line height as percentage                                         |
| `style.letterSpacing`                   | `letterSpacing`       | Letter spacing                                                    |
| `style.textAlignHorizontal`             | `textAlign`           | Lowercased (center, left, right)                                  |
| `style.textDecoration`                  | `textDecoration`      | ✨ NEW in v2 - underline, line-through (omitted if NONE)          |
| `style.textCase`                        | `textTransform`       | ✨ NEW in v2 - UPPER→uppercase, LOWER→lowercase, TITLE→capitalize |

### Meta Properties

| Figma Property   | CSS Property     | Notes                                              |
| ---------------- | ---------------- | -------------------------------------------------- |
| `id`             | `id`             | Mapped for token efficiency (nested IDs shortened) |
| `type`           | `type`           | Node type (FRAME, TEXT, etc.)                      |
| `name`           | `name`           | Node name                                          |
| `parent`         | `parent`         | Parent node ID (mapped)                            |
| `children[].id`  | `children`       | Array of child IDs (mapped)                        |
| `componentId`    | `componentId`    | Reference to component definition                  |
| `visible: false` | `visible: false` | Omitted if true                                    |
| `blendMode`      | `blendMode`      | Omitted if NORMAL or PASS_THROUGH                  |

---

## Properties INTENTIONALLY OMITTED

These Figma properties are **not** included in v2 output because they're not needed for UI building:

### Layout/Positioning

- `absoluteBoundingBox` - Layout defined by flexbox instead
- `absoluteRenderBounds` - Not needed for UI reconstruction
- `constraints` - Auto-layout handles this
- `layoutAlign`, `layoutGrow`, `layoutSizingHorizontal`, `layoutSizingVertical` - Converted to flex properties

### Internal State

- `scrollBehavior` - Not critical for static UI
- `componentPropertyReferences` - Internal Figma data
- `overrides`, `uniformScaleFactor` - Internal instance state
- `exportSettings` - Not relevant for UI building
- `prototypeDevice`, `prototypeStartNodeID` - Prototype-specific

### Styling Details

- `strokeAlign` (INSIDE/OUTSIDE/CENTER) - CSS borders are always outside
- `strokeCap`, `strokeJoin` - Vector-specific details
- `strokeDashes` - Could be added if needed (rare)
- `cornerSmoothing` - Figma-specific enhancement
- `individualStrokeWeights` - Complex stroke details
- `complexStrokeProperties` - Internal stroke data

### Text Details

- `characterStyleOverrides` - Complex text formatting (rare)
- `styleOverrideTable` - Internal style state
- `lineTypes`, `lineIndentations` - Rich text formatting (rare)
- `fontPostScriptName` - Internal font data

### Advanced Features (Could be added if needed)

- `isMask`, `maskType`, `isMaskOutline` - Masking (rare)
- `preserveRatio` - Aspect ratio lock (usually handled by layout)
- `layoutGrids` - Design grids (not rendered)
- `interactions`, `navigation` - Prototype-specific
- `arcData` - Vector arc details (rare)

### Style References

- `styles.fill`, `styles.stroke`, `styles.text`, `styles.effect` - Resolved and inlined instead
- `fillStyleId`, `strokeStyleId` - Resolved and inlined instead

---

## Special Cases

### Variable References

When a property references a variable:

```json
{
  "fills": [
    {
      "color": {
        "type": "VARIABLE_ALIAS",
        "id": "VariableID:123"
      }
    }
  ]
}
```

Becomes:

```json
{
  "backgroundColor": "$VariableID:123"
}
```

And the variable value is included in the root `variables` dictionary.

### Gradient Paints

Gradients are returned as Paint objects:

```json
{
  "background": [
    {
      "type": "GRADIENT_LINEAR",
      "gradientStops": [
        { "position": 0, "color": { "r": 1, "g": 0, "b": 0, "a": 1 } },
        { "position": 1, "color": { "r": 0, "g": 0, "b": 1, "a": 1 } }
      ]
    }
  ]
}
```

### Multiple Fills/Strokes

Only the **first** fill/stroke is preserved:

- `fills[0]` → `backgroundColor` or `background`
- `strokes[0]` → `border`

**Rationale**: Multi-layer fills/strokes are rare and can be approximated with the primary layer.

---

## Summary of v2 Additions

The following properties were **added in v2** (beyond basic CSS mapping):

1. **`transform`** - Rotation support (src/figma/reducer.ts:226)
2. **`width`/`height`** - Fixed dimensions (src/figma/reducer.ts:211-220)
3. **`minWidth`/`maxWidth`** - Size constraints (src/figma/reducer.ts:222-228)
4. **`borderRadius: [...]`** - Individual corner radii (src/figma/reducer.ts:265-277)
5. **`overflow`** - Clipping content (src/figma/reducer.ts:230-233)
6. **`flexWrap`** - Layout wrapping (src/figma/reducer.ts:203-206)
7. **`filter`** - Blur effects (src/figma/reducer.ts:296-310)
8. **`fontStyle`** - Italic text (src/figma/reducer.ts:327-332)
9. **`textDecoration`** - Underline, strikethrough (src/figma/reducer.ts:346-349)
10. **`textTransform`** - Uppercase, lowercase, capitalize (src/figma/reducer.ts:351-359)

---

## Testing Coverage

All CSS properties are covered by tests:

- Basic properties: `src/tests/output-validation.test.ts`
- New properties: `src/tests/new-css-properties.test.ts` (13 tests)
- Integration: `src/tests/final-benchmark.test.ts`
- Live data: `src/tests/live-optimization.test.ts` (99.5% reduction)
