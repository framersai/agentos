// Optional dependency shims for TypeScript builds.
// These modules are loaded dynamically at runtime when installed.

declare module '@xenova/transformers' {
  // Minimal surface needed by LocalCrossEncoderReranker.
  export const env: any;
  export const pipeline: any;
}

declare module '@huggingface/transformers' {
  // Minimal surface needed by LocalCrossEncoderReranker.
  export const env: any;
  export const pipeline: any;
}
