import type { V3Node } from "./types";

/**
 * Deep equality check for nodes, ignoring repeat/repeatExcept fields.
 * Two nodes are equal if all their properties (except repeat fields) are identical.
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;

  // Skip repeat/repeatExcept in comparison
  const keysA = Object.keys(a).filter((k) => !k.startsWith("repeat"));
  const keysB = Object.keys(b).filter((k) => !k.startsWith("repeat"));

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (keysB.indexOf(key) === -1) return false;

    const valA = a[key];
    const valB = b[key];

    if (typeof valA === "object" && typeof valB === "object") {
      if (!deepEqual(valA, valB)) return false;
    } else if (valA !== valB) {
      return false;
    }
  }

  return true;
}

/**
 * Find differences between two nodes as a map of {path: [oldValue, newValue]}.
 * Ignores repeat/repeatExcept fields.
 */
function findDifferences(base: any, current: any, prefix = ""): Record<string, [any, any]> {
  const diffs: Record<string, [any, any]> = {};

  if (typeof base !== "object" || typeof current !== "object") {
    if (base !== current) {
      diffs[prefix] = [base, current];
    }
    return diffs;
  }

  const allKeys = new Set([...Object.keys(base ?? {}), ...Object.keys(current ?? {})]);
  allKeys.delete("repeat");
  allKeys.delete("repeatExcept");

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const baseVal = base?.[key];
    const currentVal = current?.[key];

    if (typeof baseVal === "object" && typeof currentVal === "object") {
      Object.assign(diffs, findDifferences(baseVal, currentVal, path));
    } else if (baseVal !== currentVal) {
      diffs[path] = [baseVal, currentVal];
    }
  }

  return diffs;
}

/**
 * Deep merge properties from source into target, handling nested objects.
 */
function deepMerge(target: any, source: any): any {
  if (typeof source !== "object" || source === null) {
    return source;
  }

  const result = { ...target };

  for (const key in source) {
    if (typeof source[key] === "object" && source[key] !== null) {
      result[key] = deepMerge(result[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Check if an index matches a range specification.
 * Supports: number (exact), "1..15" (range), "1-15" (range), [1,2,3] (array)
 */
function indexMatchesSpec(index: number, spec: number | string | number[]): boolean {
  if (typeof spec === "number") {
    return index === spec;
  }

  if (typeof spec === "string") {
    const match = spec.match(/^(\d+)(?:\.\.|-)?(\d+)$/);
    if (match) {
      const [, start, end] = match;
      return index >= parseInt(start) && index <= parseInt(end);
    }
    return false;
  }

  if (Array.isArray(spec)) {
    return spec.includes(index);
  }

  return false;
}

/**
 * Detect if nodes starting at startIndex follow a repeating pattern.
 * Returns: { count, exceptions } or null if no compression possible.
 * Note: VECTOR nodes are never compressed because each has a unique vectorPathUri.
 */
function detectPattern(
  children: V3Node[],
  startIndex: number,
): { count: number; exceptions: Array<{ indices: number | string; merge: any }> } | null {
  if (startIndex >= children.length) return null;

  const baseNode = children[startIndex];

  // Never compress VECTOR nodes — each has a unique vectorPathUri generated from nodeId
  if (baseNode.type === "VECTOR") return null;

  let count = 1;
  const exceptions: Map<number, any> = new Map();

  for (let i = startIndex + 1; i < children.length; i++) {
    const current = children[i];

    if (deepEqual(baseNode, current)) {
      count++;
      continue;
    }

    // Check if similar (differs in simple fields like text, or style variations)
    const diffs = findDifferences(baseNode, current);
    const diffKeys = Object.keys(diffs);

    // Allow exceptions if differences are in: text, style fields, simple values
    const allowedExceptions = diffKeys.every((key) => {
      const parts = key.split(".");
      // Allow text, and style/layout field differences
      return key === "text" || parts[0] === "style" || parts[0] === "layout";
    });

    if (allowedExceptions && diffKeys.length > 0 && diffKeys.length <= 5) {
      // Build merge object from differences
      const merge: any = {};
      for (const [key, [, newValue]] of Object.entries(diffs)) {
        const parts = key.split(".");
        let obj = merge;
        for (let j = 0; j < parts.length - 1; j++) {
          if (!obj[parts[j]]) obj[parts[j]] = {};
          obj = obj[parts[j]];
        }
        obj[parts[parts.length - 1]] = newValue;
      }

      exceptions.set(i - startIndex, merge);
      count++;
    } else {
      // Pattern breaks
      break;
    }
  }

  // Only compress if count >= 2
  if (count < 2) {
    return null;
  }

  // Group consecutive exceptions and convert to array
  const exceptionsArray: Array<{ indices: number | string; merge: any }> = [];
  const sortedIndices = Array.from(exceptions.keys()).sort((a, b) => a - b);

  let i = 0;
  while (i < sortedIndices.length) {
    const currentIdx = sortedIndices[i];
    const currentMerge = exceptions.get(currentIdx)!;
    let endIdx = currentIdx;

    // Look ahead: if next indices are consecutive and have the same merge, group them
    let j = i + 1;
    while (j < sortedIndices.length) {
      const nextIdx = sortedIndices[j];
      const nextMerge = exceptions.get(nextIdx)!;

      if (nextIdx === endIdx + 1 && JSON.stringify(nextMerge) === JSON.stringify(currentMerge)) {
        endIdx = nextIdx;
        j++;
      } else {
        break;
      }
    }

    // Add grouped exception
    if (endIdx === currentIdx) {
      // Single index
      exceptionsArray.push({
        indices: currentIdx,
        merge: currentMerge,
      });
    } else {
      // Range
      exceptionsArray.push({
        indices: `${currentIdx}..${endIdx}`,
        merge: currentMerge,
      });
    }

    i = j;
  }

  return { count, exceptions: exceptionsArray };
}

/**
 * Compress children array by detecting repeating patterns.
 * Only compresses if 2+ consecutive nodes are identical or follow a pattern.
 * Recursively compresses nested children.
 */
export function compressChildren(children: V3Node[] | undefined): V3Node[] | undefined {
  if (!children || children.length === 0) return children;

  const result: V3Node[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    // First, recursively compress nested children
    if (node.children) {
      node.children = compressChildren(node.children);
    }

    // Try to detect a repeating pattern starting at this index
    const pattern = detectPattern(children, i);

    if (pattern) {
      const compressed: V3Node = {
        ...node,
        repeat: {
          count: pattern.count,
        },
      };

      if (pattern.exceptions.length > 0) {
        compressed.repeatExcept = pattern.exceptions.map((exc) => ({
          indices: exc.indices,
          merge: exc.merge,
        }));
      }

      result.push(compressed);
      i += pattern.count;
    } else {
      result.push(node);
      i++;
    }
  }

  return result;
}

/**
 * Decompress a single repeated node into its N expanded copies.
 */
export function decompressNode(node: V3Node): V3Node[] {
  if (!node.repeat) {
    // Still recursively decompress children
    if (node.children) {
      node.children = node.children.flatMap(decompressNode);
    }
    return [node];
  }

  const { count } = node.repeat;
  const expanded: V3Node[] = [];

  for (let i = 0; i < count; i++) {
    let item: V3Node = {
      ...node,
    };
    delete item.repeat;
    delete item.repeatExcept;

    // Apply exceptions for this index
    if (node.repeatExcept) {
      for (const exc of node.repeatExcept) {
        const matches = indexMatchesSpec(i, exc.indices);
        if (matches) {
          item = deepMerge(item, exc.merge);
        }
      }
    }

    // Recursively decompress nested children
    if (item.children) {
      item.children = item.children.flatMap(decompressNode);
    }

    expanded.push(item);
  }

  return expanded;
}

/**
 * Decompress an entire tree (recursively).
 * Useful for LLMs that prefer expanded format.
 */
export function decompressTree(node: V3Node): V3Node {
  const expanded = decompressNode(node);
  if (expanded.length === 1) {
    return expanded[0];
  }
  // If somehow we get multiple at root (shouldn't happen), return first
  return expanded[0];
}

/**
 * Decompress all children in a tree.
 */
export function decompressChildren(children: V3Node[] | undefined): V3Node[] | undefined {
  if (!children) return children;
  return children.flatMap((node) => decompressNode(node));
}
