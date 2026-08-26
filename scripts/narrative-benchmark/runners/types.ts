// scripts/narrative-benchmark/runners/types.ts
//
// RP-011C.8.7.1 — Contracts for the narrative benchmark framework.
//
// This file defines the shared shapes used to compare the future SoftVibe
// Narrative Intelligence pipeline against the existing narrative generation
// pipeline using identical benchmark cases.
//
// Constraints:
// - No production imports (no lib/narrative, lib/script-builder, lib/tts, etc.)
// - No generation logic — this is contracts + plumbing only.

/**
 * Preset categories a benchmark case can target.
 *
 * "asmr" and "classic-asmr" are equivalent aliases -- both adapters map
 * either to the "classic-asmr" preset used by the old pipeline and Creative
 * Intelligence. "classic-asmr" exists so case files can spell out the
 * production preset name directly (see cases/classic-asmr.ts).
 */
export type BenchmarkPreset =
  | "asmr"
  | "classic-asmr"
  | "sleep-story"
  | "meditation"
  | "kids-story"
  | "narrative";

/**
 * Execution mode for a benchmark adapter (RP-011C.8.7.3, hardened in
 * RP-011C.8.7.3A).
 *
 * "mock" (the default everywhere) runs each pipeline's isolated,
 * deterministic, non-LLM path -- no OpenAI calls, no production side
 * effects.
 *
 * "dry-run" validates that a case's arguments (preset mapping, prompt,
 * duration) are well-formed for the live execution path, without ever
 * constructing an LLM provider or importing a production generation
 * module -- not even dynamically. It exists to exercise argument/adapter
 * validation safely before a real live run.
 *
 * "live" runs the real generation path for that pipeline and requires
 * that pipeline's API key to be configured; it must always be selected
 * explicitly (never the default, never inferred).
 */
export type BenchmarkMode = "mock" | "dry-run" | "live";

/** A single, reusable benchmark scenario. Metadata only — no generated output. */
export interface BenchmarkCase {
  /** Stable, unique identifier, e.g. "transformation-01". */
  id: string;
  /** Grouping label, e.g. "transformation", "thriller", "sleep-story". */
  category: string;
  /** The prompt that would be fed to a pipeline under test. */
  prompt: string;
  /** Which SoftVibe preset this case exercises. */
  preset: BenchmarkPreset;
  /** Target duration for the generated narrative, in minutes. */
  durationMinutes: number;
  /** Human-readable qualities the output is expected to exhibit. */
  expectedQualities: string[];
}

/** The output of running a single BenchmarkCase through one pipeline adapter. */
export interface BenchmarkResult {
  /** The BenchmarkCase.id this result corresponds to. */
  caseId: string;
  /** Identifies which pipeline produced this result, e.g. "old", "creative-intelligence". */
  pipelineName: string;
  /** Raw narrative text/output produced by the pipeline. */
  output: string;
  /** Free-form metadata captured alongside the output (timing, token counts, etc.). */
  metadata: Record<string, unknown>;
}

/**
 * Abstraction the benchmark runner depends on. Implementations know how to
 * execute a BenchmarkCase against a specific narrative pipeline, but the
 * runner itself never knows those implementation details.
 *
 * Future adapters:
 * - old pipeline adapter (wraps the existing lib/narrative pipeline)
 * - creative intelligence adapter (wraps lib/creative-intelligence)
 */
export interface BenchmarkPipelineAdapter {
  /** Name identifying this pipeline in BenchmarkResult.pipelineName. */
  readonly name: string;
  /** Execute the given case and return a structured result. */
  run(benchmarkCase: BenchmarkCase): Promise<BenchmarkResult>;
}
