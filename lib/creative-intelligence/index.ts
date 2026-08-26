// lib/creative-intelligence/index.ts
//
// Public entry point for the Creative Intelligence foundation
// (RP-011C.7.14, extended in RP-011C.7.20 with a production-ready
// Knowledge Module + Registry layer, in RP-011C.7.21 with the Creative
// Context Builder, in RP-011C.7.22 with the Creative Intent Extraction
// Layer, in RP-011C.7.23 with the Story Blueprint / Narrative Planning
// Layer, in RP-011C.7.24 with the Scene Planning Layer, in RP-011C.7.25
// with the Generation Guidance Layer, in RP-011C.7.26 with the Narrative
// Writer Layer, and in RP-011C.7.27 with the Narrative Evaluation Layer).
// See README.md for what this module is and how to extend it. Nothing here
// is wired into the active generation pipeline.

export * from "./core/constants";
export * from "./core/types";
export * from "./core/contracts";
export * from "./knowledge/types";
export * from "./knowledge/registry";
export * from "./knowledge/validation";
export * from "./knowledge/init";
export * from "./context";
export * from "./intent";
export * from "./planning";
export * from "./scenes";
export * from "./guidance";
export * from "./writer";
export * from "./evaluation";
