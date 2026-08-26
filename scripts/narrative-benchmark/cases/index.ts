// scripts/narrative-benchmark/cases/index.ts
//
// RP-011C.8.7.1 — Aggregates all benchmark cases for the narrative
// benchmark framework. Metadata only. No generation happens here.

import type { BenchmarkCase } from "../runners/types";
import { transformationCases } from "./transformation";
import { thrillerCases } from "./thriller";
import { sleepStoryCases } from "./sleep-story";
import { narrativeCases } from "./narrative";
import { kidsStoryCases } from "./kids-story";
import { meditationCases } from "./meditation";
import { classicAsmrCases } from "./classic-asmr";
import { asmrCreativeDirectionCases } from "./asmr-creative-direction";

export { transformationCases } from "./transformation";
export { thrillerCases } from "./thriller";
export { sleepStoryCases } from "./sleep-story";
export { narrativeCases } from "./narrative";
export { kidsStoryCases } from "./kids-story";
export { meditationCases } from "./meditation";
export { classicAsmrCases } from "./classic-asmr";
export { asmrCreativeDirectionCases } from "./asmr-creative-direction";

export const allBenchmarkCases: BenchmarkCase[] = [
  ...transformationCases,
  ...thrillerCases,
  ...sleepStoryCases,
  ...narrativeCases,
  ...kidsStoryCases,
  ...meditationCases,
  ...classicAsmrCases,
  ...asmrCreativeDirectionCases,
];

export function getBenchmarkCaseById(id: string): BenchmarkCase | undefined {
  return allBenchmarkCases.find((benchmarkCase) => benchmarkCase.id === id);
}

export function getBenchmarkCasesByCategory(category: string): BenchmarkCase[] {
  return allBenchmarkCases.filter(
    (benchmarkCase) => benchmarkCase.category === category
  );
}
