/**
 * @file index.ts
 * @description Barrel re-exports for the AgentOS orchestration layer.
 *
 * The orchestration subsystem provides:
 * - **IR**: Intermediate representation types and utilities for graph-based workflows
 * - **Events**: Event definitions and infrastructure for orchestration runtime
 * - **Checkpoint**: Checkpoint persistence and recovery for long-running workflows
 * - **Runtime**: State management, scheduling, execution, and graph runtime engines
 *
 * Consumers should import from this module rather than from individual subdirectories
 * to keep import paths stable across internal refactors.
 */

// IR types
export * from './ir/index.js';
// Events
export * from './events/index.js';
// Checkpoint
export * from './checkpoint/index.js';
// Runtime
export * from './runtime/index.js';
// Builders (public API)
export * from './builders/index.js';
// Compiler (advanced use)
export * from './compiler/index.js';
// Planning (self-expanding mission orchestrator)
export * from './planning/index.js';
// Orchestration tools (request_expansion, manage_graph)
export * from './tools/index.js';

// Turn planner (moved from core/orchestration/)
export * from './turn-planner/index.js';
