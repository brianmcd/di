import { ResolveDeps } from './resolvers.js';
import { Token } from './tokens.js';

/**
 * Interface for classes with static deps property.
 * Enforces that the constructor parameters must match the types resolved from deps.
 */
export interface InjectableClass<T = unknown, Deps extends readonly Token<any>[] = readonly []> {
  deps?: Deps;
  new (...args: ResolveDeps<Deps>): T;
}
