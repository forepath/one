export {};

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `createCorrelationIdMiddleware` for the lifetime of the request. */
    correlationId?: string;
  }
}
