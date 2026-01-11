import type { TypedToken, Token } from './tokens.js';

/**
 * Extract the resolved type from a service token.
 * - For TypedToken<T> → returns T
 * - For class constructor → returns the instance type
 */
export type ResolveToken<T> =
  T extends TypedToken<infer U> ? U : T extends new (...args: any[]) => infer U ? U : never;

/**
 * Extract types from a deps array as a tuple.
 * Maps each token to its resolved type.
 */
export type ResolveDeps<T extends readonly Token<any>[]> = {
  [K in keyof T]: ResolveToken<T[K]>;
};
