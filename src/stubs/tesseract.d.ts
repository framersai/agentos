/**
 * Type declaration stub for the optional `tesseract.js` peer dependency.
 * This module is loaded dynamically at runtime when installed.
 * @see {@link VisionPipeline} for usage context.
 */
declare module 'tesseract.js' {
  const Tesseract: {
    createWorker: (lang: string) => Promise<any>;
  };
  export default Tesseract;
}
