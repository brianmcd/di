import type { ResolveDeps } from './resolvers.js';
import type { Token } from './tokens.js';

export interface FactoryProvider<
  T,
  Deps extends readonly Token<any>[] = readonly Token<any>[],
  DestroyDeps extends readonly Token<any>[] = readonly [],
> {
  provide: Token<T>;
  deps: Deps;
  factory: FactoryFn<T, Deps>;
  onDestroy?: {
    deps?: DestroyDeps;
    handler: (...args: ResolveDeps<DestroyDeps>) => void | Promise<void>;
  };
}

/**
 * Factory function type - can be sync or async.
 * Parameters must match the types resolved from deps.
 */
type FactoryFn<T, Deps extends readonly Token<any>[] = readonly Token<any>[]> = (
  ...args: ResolveDeps<Deps>
) => T | Promise<T>;
