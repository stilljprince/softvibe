// lib/creative-intelligence/orchestration/index.ts
//
// Public entry point for the Creative Intelligence Orchestration Layer
// (RP-011C.8.4). Not exported from lib/creative-intelligence/index.ts on
// purpose -- this stays a migration-foundation layer, not part of the
// module's general public surface, until an explicit future pass decides
// otherwise (same posture as prototype/index.ts).

export * from "./types";
export * from "./writer-adapter";
export * from "./pipeline";
