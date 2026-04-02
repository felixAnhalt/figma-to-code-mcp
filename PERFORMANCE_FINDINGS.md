# Exploration Summary: Figma MCP Performance Profile

## Quick Findings

### 1. **Extraction/Optimization Architecture: THREE-PHASE PIPELINE**

The system works in three distinct phases, each addressing different optimization concerns:

```
Phase 1 (buildNormalizedGraph):  Raw API → v3 nested tree (40-50% reduction)
Phase 2 (enrichDefinitions):      Fetch component source definitions (parallel)
Phase 3 (Output):                Serialize to JSON/YAML + cache (30-70% total reduction)
```

**Key insight**: Each phase is independent and composable. `buildNormalizedGraph()` is reused for component source nodes, avoiding code duplication.

---

### 2. **Current Metrics: EMPIRICAL + THEORETICAL**

#### Confirmed Metrics (from test files)

- **YAML vs JSON**: YAML is 5-15% more token-efficient (benchmark.test.ts)
- **Nested tree savings**: 30% reduction from flat dictionary format (id-mapping-benchmark.test.ts)
- **Default omission**: ~15% savings by excluding zero/default values
- **Smart filtering**: 2-5% additional from collapsed wrappers + rectangle suppression
- **Overall reduction**: 30-70% from raw API response (live-optimization.test.ts)

#### Theoretical Opportunities (from additional-optimizations.test.ts)

- Padding omission when all zeros: ~60 bytes/occurrence
- Gap omission when 0: ~8 bytes/occurrence
- Layout omission when all defaults: 5-10% of layout data
- Lazy component set fetching: 20-50% of Phase 2 calls (not implemented)

**Status**: Most obvious optimizations already implemented in reducer.ts

---

### 3. **Performance Bottlenecks: RANKED BY IMPACT**

| Rank | Bottleneck                   | Impact            | Cause                                | Mitigation                                    |
| ---- | ---------------------------- | ----------------- | ------------------------------------ | --------------------------------------------- |
| 1    | Sequential Rate Limiting     | 1-5+ sec          | FIFO queue, 100ms spacing            | Caching; acceptable for most files            |
| 2    | Phase 2 Enrichment           | 1-5+ sec          | Parallel library fetches             | Already parallelized; one request per library |
| 3    | No Lazy Enrichment           | +20-50% API calls | Fetches all component set variants   | Not implemented; acceptable tradeoff          |
| 4    | Deep Nesting Traversal       | < 100ms           | O(n) recursive walks                 | Nested tree mitigates vs flat passes          |
| 5    | Variable Resolution Two-Pass | < 50ms            | Concrete values, then nested aliases | Circular ref prevention justified             |

**Bottom line**: No catastrophic bottlenecks; most delays are acceptable for batch use cases (LLM context gathering, not real-time UI).

---

### 4. **Architectural Strengths**

1. **Clean Phase Separation**: Fetch → Normalize → Enrich (single responsibility)
2. **Graceful Degradation**: Phase 2 skips on 403 (library access denied); output still usable
3. **Smart Filtering**: Removes noise without configuration (transparent wrappers, matching rectangles)
4. **Composable Reducers**: `buildNormalizedGraph()` works on any node, enabling component source fetching
5. **Variable Inlining**: No $ref strings; values resolved inline as rgba() or concrete numbers
6. **Nested Tree Design**: Mirrors visual hierarchy; optimal for LLM reasoning

**Conclusion**: Architecture is well-designed for its use case (LLM UI building data ingestion).

---

### 5. **Architectural Weaknesses**

1. **Sequential Rate Limiting**: All requests through single 100ms-spaced queue (unavoidable due to Figma tier limits)
2. **No Streaming**: Entire response built in RAM before transmission (acceptable; typical < 500KB)
3. **Fixed depth=100**: Doesn't adapt to actual tree (most trees are shallower)
4. **No Metrics**: Performance characteristics are anecdotal (no timing, cache stats, etc.)
5. **No Lazy Enrichment**: All component set variants fetched even if only 1 used
6. **Test-Only Injection**: componentMap parameter works for tests, but baked into main flow

**Severity**: Low-to-medium; improvements are nice-to-haves, not critical.

---

### 6. **Metrics Currently Tracked**

**Implemented**:

- Cache TTL management (5-minute default)
- Rate limit attempts + exponential backoff (3 retries on 429)
- Error logging with stack traces

**Not Implemented**:

- Response size before/after (hand-calculated in tests only)
- API call count per operation
- Time spent in Phase 1 vs Phase 2 vs Phase 3
- Cache hit/miss ratio
- Peak memory usage per response
- Variable resolution success/failure rate

**Recommendation**: Add console.time() markers to generateMCPResponse() phases; pipe to logger.

---

### 7. **Large File Handling: KNOWN LIMITS**

**Tested Scenarios**:

- Discord library with ~357 components (live-optimization-discord.test.ts)
- Test fixtures (final-benchmark.test.ts, id-mapping-benchmark.test.ts)

**Expected Behavior**:

- Files with < 1000 nodes: < 1 second (mostly Phase 1)
- Files with > 1000 nodes + 100+ components: 2-10 seconds (Phase 2 dominates)
- Very large libraries (1000+ components): Unknown; Phase 2 rate limiting may accumulate

**Streaming**: Not supported; full response in memory. No published size limit.

---

### 8. **Deep Nesting Handling: NO SPECIAL LOGIC**

**How it works**:

- `depth=100` parameter in fetchNodesBatch() fetches full subtrees in one API call
- Recursive tree walking in buildNormalizedGraph() processes all levels
- No special handling for extremely deep trees

**Expected Behavior**:

- 10 levels deep: No issue
- 50 levels deep: Still fine (recursive call stack is bounded by tree depth, not by Figma's API)
- 100+ levels deep: Theoretical risk of stack overflow (not tested)

**Conclusion**: Depth handling is straightforward; no special optimizations needed for typical UI hierarchies.

---

### 9. **Code Structure: 1783 LINES OF OPTIMIZATION LOGIC**

| Component           | LOC | Focus                             |
| ------------------- | --- | --------------------------------- |
| reducer.ts          | 614 | Core optimization (40% of system) |
| index.ts            | 546 | Orchestration + enrichment (30%)  |
| variableResolver.ts | 188 | Variable aliasing (11%)           |
| rateLimit.ts        | 83  | Rate limiting (5%)                |
| batchFetch.ts       | 61  | Batching (3%)                     |
| types.ts            | 200 | Type definitions (11%)            |
| idMapper.ts         | 59  | ID compression (not used; 3%)     |
| cache.ts            | 32  | Simple TTL cache (2%)             |

**Key insight**: buildNormalizedGraph() (reducer.ts) is the workhorse; ~35% of all logic dedicated to optimization.

---

### 10. **Performance Testing Approach: TIERED**

**Tier 1 (Always enabled)**:

- YAML token efficiency (benchmark.test.ts)

**Tier 2 (Requires fixture)**:

- Final benchmark (final-benchmark.test.ts)
- ID mapping validation (id-mapping-benchmark.test.ts)
- Additional optimizations analysis (additional-optimizations.test.ts)

**Tier 3 (Requires live Figma API)**:

- Live optimization test (live-optimization.test.ts)
- Discord library enrichment test (live-optimization-discord.test.ts)

**Status**: Test infrastructure is good; but no continuous benchmarking in CI (tests are skipped by default).

---

## Recommendations for Further Investigation

### If Performance Becomes an Issue (Priority Order)

1. **Add timing metrics** (Easy, immediate insight)

   - Mark Phase 1, 2, 3 boundaries
   - Log aggregate time per phase
   - Track cache hit ratio

2. **Run Discord test on real Figma** (Easy, real-world validation)

   - Live-optimization-discord.test.ts already exists
   - Profile Phase 2 enrichment specifically
   - Identify if rate limiting is real bottleneck

3. **Implement lazy component set fetching** (Medium effort, 20-50% Phase 2 savings)

   - Only fetch variants actually used in consumer file
   - Would require variants dict to be populated lazily
   - Good tradeoff: complexity for speed

4. **Add streaming output support** (Hard, low priority)

   - JSONLines format for large responses
   - Useful if files exceed 1MB (currently rare)
   - Requires significant refactoring

5. **Profile memory usage** (Easy, useful for deployments)
   - Peak memory per file size
   - Memory leaks in cache (TTL expiration working?)
   - Scaling characteristics

---

## Bottom Line

**The system is well-optimized for its primary use case**: Transforming Figma design data into LLM-consumable JSON/YAML. The 30-70% size reduction is substantial and the three-phase architecture provides good separation of concerns.

**Performance bottlenecks are known and acceptable**: Rate limiting and Phase 2 enrichment add 1-5 seconds for typical files, which is fine for batch operations. The 5-minute cache mitigates repeated requests.

**No obvious quick wins remain**: The reducer.ts already implements most obvious optimizations. Further improvements require architectural changes (streaming, lazy loading) or API-level changes (parallel requests), neither of which are justified by current performance.

**Recommended next step**: Run the Discord library test on real Figma API to get actual Phase 2 timings. If Phase 2 proves to be the actual bottleneck, implement lazy component set fetching.
