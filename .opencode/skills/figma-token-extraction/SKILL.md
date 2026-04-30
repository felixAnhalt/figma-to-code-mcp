---
name: figma-token-extraction
description: Design token extraction pipeline — frequency counting, semantic naming, token replacement, and varRef stripping.
---

## What I do

I know the full design token extraction pipeline in `src/figma/tokenizer/`.

## Pipeline (in `extractTokens()` at `src/figma/tokenizer/index.ts`)

### Step 1: Collect Figma variable refs

`collectFigmaVarRefs()` walks root + componentSets gathering `_varRefs` sidecars from `Style` and `Layout` objects. First-encountered name wins.

### Step 2: Count frequencies

`countFrequencies()` (in `frequencies.ts`) tallies colors, spacings, radii, shadows, typographies, padding combos, heights. Var-bound values are skipped.

### Step 3: Build semantic registries

`buildSemanticTokenRegistry()` (in `registry.ts`) assigns semantic names from frequency-ordered data. Categories:

- Colors → `COLOR_SEMANTIC_NAMES` (primary, secondary, background, text, border, ...)
- Shadows → `SHADOW_SEMANTIC_NAMES` (card, dropdown, modal, ...)
- Spacings → auto-generated (spacingXs, spacingSm, ...)
- Radii → auto-generated (radiusSm, radiusMd, ...)
- Typographies → auto-generated (headingXl, body, caption, ...)
- Padding combos → `PADDING_COMBO_SEMANTIC_NAMES`
- Heights → auto-generated (heightSm, heightMd, ...)

### Step 4: Build tokens registry

Merges invented tokens with Figma variable entries. Multiple Figma variables → same raw value → kept distinct.

### Step 5: Replace raw values with token refs

`replaceNodeTokens()` and `replaceComponentSetTokens()` (in `replace/`) swap raw rgba/dimensions for `{ token: "category.name" }` references.

### Step 6: Strip `_varRefs`

`stripVarRefsFromResponse()` removes all `_varRefs` sidecars — must not appear in final output.

## When to use me

Use this when:

- Adding a new token category
- Debugging token assignment
- Understanding why a value got a particular semantic name
- Modifying the tokenizer pipeline
