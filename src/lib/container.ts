import type { FactoryProvider } from './types/factory-provider.js';
import type { InjectableClass } from './types/injectable-class.js';
import type { Token } from './types/tokens.js';
import { ScopeBuilder } from './scope-builder.js';
import { ScopedContainer } from './scoped-container.js';
import { hasOnDestroy } from './utils/has-on-destroy.js';
import { hasOnInit } from './utils/has-on-init.js';
import { tokenToString } from './utils/token-to-string.js';

/**
 * Data for a scoped class registration.
 */
export interface ScopedClassData<T = unknown> {
  Class: InjectableClass<T, readonly Token<any>[]>;
  deps: readonly Token<unknown>[];
}

/**
 * Data required to construct a Container.
 * This is the "state" that ContainerBuilder prepares.
 */
export interface ContainerState {
  instances: Map<Token<unknown>, unknown>;
  factoryProviders: Map<Token<unknown>, FactoryProvider<any, any, any>>;
  valueProviders: Set<Token<unknown>>;
  initOrder: Token<unknown>[];
  // Scoped provider data (not instances - stored for Scope creation)
  scopedClassProviders: Map<Token<unknown>, ScopedClassData>;
  scopedFactoryProviders: Map<Token<unknown>, FactoryProvider<any, any, any>>;
  scopedValueTokens: Set<Token<unknown>>;
}

export class Container {
  private readonly instances: Map<Token<unknown>, unknown>;
  private readonly factoryProviders: Map<Token<unknown>, FactoryProvider<any, any, any>>;
  private readonly valueProviders: Set<Token<unknown>>;
  private readonly initOrder: Token<unknown>[];
  private readonly scopedClassProviders: Map<Token<unknown>, ScopedClassData>;
  private readonly scopedFactoryProviders: Map<Token<unknown>, FactoryProvider<any, any, any>>;
  private readonly scopedValueTokens: Set<Token<unknown>>;
  private isInitialized = false;

  public constructor(state: ContainerState) {
    this.instances = state.instances;
    this.factoryProviders = state.factoryProviders;
    this.valueProviders = state.valueProviders;
    this.initOrder = state.initOrder;
    this.scopedClassProviders = state.scopedClassProviders;
    this.scopedFactoryProviders = state.scopedFactoryProviders;
    this.scopedValueTokens = state.scopedValueTokens;
  }

  /**
   * Get an instance by its token.
   */
  public get<T>(token: Token<T>): T {
    if (!this.isInitialized) {
      throw new Error('Container not initialized. Call init() before getting instances.');
    }
    const instance = this.instances.get(token);
    if (instance === undefined) {
      throw new Error(`Token not registered: ${tokenToString(token)}`);
    }
    return instance as T;
  }

  /**
   * Create a new scoped container for scoped instances.
   * Scoped instances are created on-demand within the container and destroyed when the scoped container is destroyed.
   */
  public createScope(): ScopedContainer {
    return new ScopedContainer(
      this.instances,
      this.scopedClassProviders,
      this.scopedFactoryProviders
    );
  }

  /**
   * Create a ScopeBuilder for constructing a scoped container with provided values.
   * Use this when you have scoped value tokens that need to be supplied per-scope.
   */
  public createScopeBuilder(): ScopeBuilder {
    return new ScopeBuilder(
      this.instances,
      this.scopedClassProviders,
      this.scopedFactoryProviders,
      this.scopedValueTokens
    );
  }

  /**
   * Initialize all instances - calls onInit() in topological order (dependencies before dependents).
   * Only class-registered instances have onInit called (not values or factories).
   */
  public async init(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Container already initialized');
    }

    for (const token of this.initOrder) {
      // Skip externally-managed instances (values and factories)
      if (this.valueProviders.has(token) || this.factoryProviders.has(token)) {
        continue;
      }

      const instance = this.instances.get(token);

      if (hasOnInit(instance)) {
        await instance.onInit();
      }
    }

    this.isInitialized = true;
  }

  /**
   * Destroy all instances - calls onDestroy() in reverse topological order (dependents before dependencies).
   */
  public async destroy(): Promise<void> {
    const errors: Error[] = [];

    for (const token of [...this.initOrder].reverse()) {
      const factoryProvider = this.factoryProviders.get(token);

      try {
        // There's an important nuance here: if an instance was provided via a factory or value,
        // then we don't want invoke onDestroy on the instance, even if it exists. There could be a
        // scenario where a factory is providing an instance of a third party dependency, and that
        // third party may happen to have an `onDestroy` method. We don't want to blindly invoke
        // that `onDestroy`, so if an instance was provided via a factory, we never check for an
        // `onDestroy` on that instance.
        if (factoryProvider) {
          if (factoryProvider?.onDestroy) {
            const hookDeps = factoryProvider.onDestroy.deps ?? [];
            const resolvedDeps = hookDeps.map((d: Token<unknown>) => this.get(d));
            await factoryProvider.onDestroy.handler(...resolvedDeps);
          }
          continue;
        }

        // Skip value-provided instances - they are externally managed.
        if (this.valueProviders.has(token)) {
          continue;
        }

        // Only class-registered instances get onDestroy called.
        const instance = this.instances.get(token);
        if (hasOnDestroy(instance)) {
          await instance.onDestroy();
        }
      } catch (error) {
        errors.push(error as Error);
      }
    }

    this.instances.clear();
    this.factoryProviders.clear();
    this.valueProviders.clear();
    this.initOrder.length = 0;
    this.scopedClassProviders.clear();
    this.scopedFactoryProviders.clear();
    this.scopedValueTokens.clear();
    this.isInitialized = false;

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Errors during container destruction');
    }
  }
}
