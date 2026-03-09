/**
 * Resolves component instances by merging instance overrides with main component properties.
 * This ensures that when an instance references a component, we can reconstruct the full tree.
 */
export function resolveInstances(node: any, componentMap: Record<string, any>): void {
  if (!node) return;

  // If this is an instance, merge with component data
  if (node.type === "INSTANCE" && node.componentId) {
    const component = componentMap[node.componentId];
    if (component) {
      // Store component reference
      node._componentData = component;

      // Apply overrides if they exist
      if (node.componentProperties) {
        node._overrides = node.componentProperties;
      }
    }
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      resolveInstances(child, componentMap);
    }
  }
}
