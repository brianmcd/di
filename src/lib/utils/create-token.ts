import type { TypedToken } from '../types/tokens.js';

/**
 * Create a typed token for non-class dependencies (like database connections).
 * The type parameter T specifies what type the token resolves to.
 *
 * @example
 * export const DATABASE = createToken<Database>('DATABASE');
 */
export function createToken<T>(name: string): TypedToken<T> {
  return Symbol.for(name) as TypedToken<T>;
}
