// scripts/narrative-benchmark/output/serializer.ts
//
// RP-011C.8.7.1 — Serializer utilities for benchmark output.
//
// These utilities describe HOW benchmark results would be laid out on disk:
//
//   benchmark-output/
//     <case-id>/
//       old.txt
//       new.txt
//       metadata.json
//
// This module only computes paths and serialized string content. It does
// NOT touch the filesystem — no actual output files are created here.

import type { BenchmarkResult } from "../runners/types";

const OUTPUT_ROOT = "benchmark-output";

/** File name used for a given pipeline's raw output within a case directory. */
export function outputFileName(pipelineName: string): string {
  if (pipelineName === "old") return "old.txt";
  if (pipelineName === "creative-intelligence") return "new.txt";
  return `${pipelineName}.txt`;
}

/** Relative directory a given case's benchmark output would live under. */
export function caseOutputDir(caseId: string): string {
  return `${OUTPUT_ROOT}/${caseId}`;
}

/** Relative path to a pipeline's raw output file for a given case. */
export function outputFilePath(caseId: string, pipelineName: string): string {
  return `${caseOutputDir(caseId)}/${outputFileName(pipelineName)}`;
}

/** Relative path to the metadata.json file for a given case. */
export function metadataFilePath(caseId: string): string {
  return `${caseOutputDir(caseId)}/metadata.json`;
}

/** Serialize a BenchmarkResult's raw output as plain text file content. */
export function serializeOutputText(result: BenchmarkResult): string {
  return result.output;
}

/** Serialize one or more BenchmarkResults for a case into metadata.json content. */
export function serializeMetadata(
  caseId: string,
  results: BenchmarkResult[]
): string {
  const metadata = {
    caseId,
    pipelines: results.map((result) => ({
      pipelineName: result.pipelineName,
      metadata: result.metadata,
    })),
  };
  return JSON.stringify(metadata, null, 2);
}
