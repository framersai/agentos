/**
 * @file IVideoAnalyzer.ts
 * Provider interface for video understanding / analysis.
 *
 * Implementations typically wrap a multimodal LLM (Gemini, GPT-4o, Claude)
 * or a dedicated video-understanding API to extract descriptions, scene
 * segments, detected objects, and on-screen text from a video.
 *
 * @see {@link IVideoGenerator} for the write-side generation interface.
 */

import type { VideoAnalyzeRequest, VideoAnalysis } from './types.js';

// ---------------------------------------------------------------------------
// IVideoAnalyzer
// ---------------------------------------------------------------------------

/**
 * Abstraction over a video analysis / understanding backend.
 *
 * Unlike {@link IVideoGenerator}, analysis is typically a single-shot
 * operation with no capability negotiation required — every analyser is
 * expected to accept either a URL or a raw buffer and return a structured
 * {@link VideoAnalysis}.
 */
export interface IVideoAnalyzer {
  /**
   * Analyse a video and return structured understanding results.
   *
   * @param request - The analysis parameters (video source + optional prompt).
   * @returns Structured analysis including description, scenes, objects, etc.
   */
  analyzeVideo(request: VideoAnalyzeRequest): Promise<VideoAnalysis>;
}
