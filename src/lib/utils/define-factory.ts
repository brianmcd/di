import type { FactoryProvider } from '../types/factory-provider.js';
import type { Token } from '../types/tokens.js';

/**
 * Helper to define factories with type inference.
 *
 * This function is an identity function that returns the config object unchanged.
 * Its purpose is to provide automatic type inference for the generic parameters,
 * so you don't have to manually specify them when creating a FactoryProvider.
 *
 * Without defineFactory:
 *   const factory: FactoryProvider<DbType, readonly [typeof CONFIG]> = { ... };
 *
 * With defineFactory:
 *   const factory = defineFactory({ ... }); // Types inferred from provide and deps
 *
 * @example
 * const dbFactory = defineFactory({
 *   provide: DATABASE,
 *   deps: [DB_CONTAINER_OPTIONS] as const,
 *   factory: (options) => new Database(options.connectionString),
 *   onDestroy: {
 *     deps: [DATABASE] as const,
 *     handler: async (db) => await db.destroy()
 *   }
 * });
 */
export function defineFactory<
  T,
  Deps extends readonly Token<any>[],
  DestroyDeps extends readonly Token<any>[] = readonly [],
>(config: FactoryProvider<T, Deps, DestroyDeps>): FactoryProvider<T, Deps, DestroyDeps> {
  return config;
}
