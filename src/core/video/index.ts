/**
 * @file index.ts
 * Barrel export for the video generation and analysis subsystem.
 *
 * Re-exports all public types, interfaces, and the fallback proxy so
 * consumers can import from `@agentos/core/video` (or the relative path)
 * without reaching into individual files.
 */

export * from './types.js';
export * from './IVideoGenerator.js';
export * from './IVideoAnalyzer.js';
export * from './FallbackVideoProxy.js';
