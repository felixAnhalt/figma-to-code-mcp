/**
 * ID Mapper - Maps long nested Figma IDs to shorter integer-based IDs
 *
 * Strategy: Keep first segment of nested IDs, map everything after with global counter
 * Examples:
 *   "4014:2428" → "4014:2428" (unchanged - no semicolons)
 *   "I4014:2428;27011:30191" → "I4014:2428;0"
 *   "I4014:2428;27011:30191;3614:74" → "I4014:2428;0"
 *   "I4014:2429;27011:30192" → "I4014:2429;1" (global counter continues)
 */

export class IdMapper {
  private counter = 0;
  private cache = new Map<string, string>();

  /**
   * Map a Figma ID to a shorter format
   * - Root IDs (no semicolons): returned unchanged
   * - Nested IDs (with semicolons): first segment kept, rest mapped to integer
   */
  map(figmaId: string): string {
    // If no semicolon, it's a root ID - return as-is
    if (!figmaId.includes(";")) {
      return figmaId;
    }

    // Check cache first
    const cached = this.cache.get(figmaId);
    if (cached !== undefined) {
      return cached;
    }

    // Extract first segment (before first semicolon)
    const firstSegment = figmaId.split(";")[0];

    // Map to: firstSegment;counter
    const mapped = `${firstSegment};${this.counter}`;
    this.counter++;

    // Cache and return
    this.cache.set(figmaId, mapped);
    return mapped;
  }

  /**
   * Get current counter value (for debugging/stats)
   */
  getCounter(): number {
    return this.counter;
  }

  /**
   * Reset mapper state (for testing)
   */
  reset(): void {
    this.counter = 0;
    this.cache.clear();
  }
}
