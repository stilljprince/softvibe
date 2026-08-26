// scripts/narrative-benchmark/runners/benchmark-runner.ts
//
// RP-011C.8.7.1 — Benchmark runner. Accepts a BenchmarkPipelineAdapter and a
// BenchmarkCase, executes it through the adapter, and returns a structured
// BenchmarkResult. The runner has no knowledge of what a specific adapter
// does internally, and never calls a model provider itself.

import type {
  BenchmarkCase,
  BenchmarkPipelineAdapter,
  BenchmarkResult,
} from "./types";

export class BenchmarkRunner {
  constructor(private readonly adapter: BenchmarkPipelineAdapter) {}

  /** Run a single benchmark case through this runner's adapter. */
  async runCase(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult> {
    return this.adapter.run(benchmarkCase);
  }

  /** Run multiple benchmark cases sequentially through this runner's adapter. */
  async runCases(benchmarkCases: BenchmarkCase[]): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    for (const benchmarkCase of benchmarkCases) {
      results.push(await this.runCase(benchmarkCase));
    }
    return results;
  }
}

/**
 * Run the same benchmark case through two adapters (e.g. old pipeline vs.
 * creative intelligence pipeline) for direct comparison.
 */
export async function runComparison(
  benchmarkCase: BenchmarkCase,
  adapterA: BenchmarkPipelineAdapter,
  adapterB: BenchmarkPipelineAdapter
): Promise<{ a: BenchmarkResult; b: BenchmarkResult }> {
  const a = await new BenchmarkRunner(adapterA).runCase(benchmarkCase);
  const b = await new BenchmarkRunner(adapterB).runCase(benchmarkCase);
  return { a, b };
}

/**
 * Run a single benchmark case through any number of adapters (e.g. old
 * pipeline vs. creative intelligence, plus future pipelines) and return
 * one BenchmarkResult per adapter, in the same order as `adapters`.
 */
export async function runCaseThroughAdapters(
  benchmarkCase: BenchmarkCase,
  adapters: BenchmarkPipelineAdapter[]
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const adapter of adapters) {
    results.push(await new BenchmarkRunner(adapter).runCase(benchmarkCase));
  }
  return results;
}
