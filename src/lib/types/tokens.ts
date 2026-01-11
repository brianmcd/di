/**
 *
 * Service token types - can be a class constructor or a typed symbol
 */
export type Token<T> = TypedToken<T> | (new (...args: any[]) => T);

/**
 * A branded symbol type that carries type information at the type level.
 * Use createToken<T>() to create typed tokens for non-class dependencies.
 */
export type TypedToken<T> = symbol & { readonly __type?: T };
