declare module 'sharp' {
  interface Sharp {
    removeAlpha(): Sharp;
    toColourspace(space: string): Sharp;
    raw(): Sharp;
    toBuffer(options?: { resolveWithObject: boolean }): Promise<{ data: Buffer; info: any }>;
    resize(width?: number, height?: number, options?: any): Sharp;
    toFormat(format: string, options?: any): Sharp;
    metadata(): Promise<any>;
  }

  function sharp(input?: Buffer | string | ArrayBuffer): Sharp;
  export default sharp;
}
