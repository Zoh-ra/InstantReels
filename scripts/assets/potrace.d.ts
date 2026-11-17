declare module 'potrace' {
  interface TraceOptions {
    threshold?: number;
    turdSize?: number;
    optTolerance?: number;
    alphaMax?: number;
    color?: string;
    background?: string;
  }
  const potrace: { trace(file: string, options: TraceOptions, cb: (err: Error | null, svg: string) => void): void };
  export default potrace;
}
