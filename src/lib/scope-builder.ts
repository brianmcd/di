import type { FactoryProvider } from './types/factory-provider.js';
import type { Token } from './types/tokens.js';
import type { ScopedClassData } from './container.js';
import { ScopedContainer } from './scoped-container.js';
import { tokenToString } from './utils/token-to-string.js';

/**
 * A builder for creating scoped containers with provided values.
 * Use this to supply values for tokens declared with `registerScopedValue()`.
 */
export class ScopeBuilder {
  private readonly values: Map<Token<unknown>, unknown> = new Map();

  public constructor(
    private readonly parentInstances: Map<Token<unknown>, unknown>,
    private readonly scopedClassProviders: Map<Token<unknown>, ScopedClassData>,
    private readonly scopedFactoryProviders: Map<Token<unknown>, FactoryProvider<any, any, any>>,
    private readonly scopedValueTokens: Set<Token<unknown>>
  ) {}

  /**
   * Provide a value for a scoped value token declared with `registerScopedValue()`.
   */
  public provideValue<T>(token: Token<T>, value: T): this {
    if (!this.scopedValueTokens.has(token)) {
      throw new Error(
        `Token ${tokenToString(token)} is not registered as a scoped value. Use ContainerBuilder.registerScopedValue() first.`
      );
    }
    this.values.set(token, value);
    return this;
  }

  /**
   * Build the scoped container with all provided values.
   * Throws if any declared scoped value tokens have not been provided.
   */
  public build(): ScopedContainer {
    for (const token of this.scopedValueTokens) {
      if (!this.values.has(token)) {
        throw new Error(
          `Missing scope value for token: ${tokenToString(token)}. Call .provideValue() before .build().`
        );
      }
    }

    return new ScopedContainer(
      this.parentInstances,
      this.scopedClassProviders,
      this.scopedFactoryProviders,
      this.values,
      this.scopedValueTokens
    );
  }
}
