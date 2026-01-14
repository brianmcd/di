import type { FactoryProvider } from './types/factory-provider.js';
import type { Token } from './types/tokens.js';
import type { ScopedClassData } from './container.js';
import { hasOnDestroy } from './utils/has-on-destroy.js';
import { hasOnInit } from './utils/has-on-init.js';
import { tokenToString } from './utils/token-to-string.js';

/**
 * A ScopedContainer represents a context for scoped instances.
 * Scoped instances are created on-demand and cached within this container.
 * When the scoped container is destroyed, all scoped instances are cleaned up.
 */
export class ScopedContainer {
  private readonly instances: Map<Token<unknown>, unknown> = new Map();
  private readonly creationOrder: Token<unknown>[] = [];
  private _isDestroyed = false;

  public constructor(
    private readonly parentInstances: Map<Token<unknown>, unknown>,
    private readonly scopedClassProviders: Map<Token<unknown>, ScopedClassData>,
    private readonly scopedFactoryProviders: Map<Token<unknown>, FactoryProvider<any, any, any>>
  ) {}

  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Get a singleton instance from the parent container.
   * Throws if the token is a scoped provider - use getScoped() for those.
   */
  public get<T>(token: Token<T>): T {
    if (this._isDestroyed) {
      throw new Error('Scope has been destroyed');
    }

    // Check if this is a scoped provider - if so, throw an error
    if (this.scopedClassProviders.has(token) || this.scopedFactoryProviders.has(token)) {
      throw new Error(
        `Token ${tokenToString(token)} is a scoped provider. Use getScoped() instead of get().`
      );
    }

    // Only return singletons from parent container
    const instance = this.parentInstances.get(token);

    if (instance === undefined) {
      throw new Error(`Token not registered: ${tokenToString(token)}`);
    }

    return instance as T;
  }

  /**
   * Get a scoped instance by its token.
   * Creates and caches the instance within this scope on first access.
   * Throws if the token is not a scoped provider.
   */
  public async getScoped<T>(token: Token<T>): Promise<T> {
    if (this._isDestroyed) {
      throw new Error('Scope has been destroyed');
    }

    // Check if already cached in this scope
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    // Check if it's a scoped class
    if (this.scopedClassProviders.has(token)) {
      return this.createScopedClassInstance(token);
    }

    // Check if it's a scoped factory
    if (this.scopedFactoryProviders.has(token)) {
      return this.createScopedFactoryInstance(token);
    }

    // Not a scoped provider - throw an error
    if (this.parentInstances.has(token)) {
      throw new Error(
        `Token ${tokenToString(token)} is a singleton. Use get() instead of getScoped().`
      );
    }

    throw new Error(`Token not registered: ${tokenToString(token)}`);
  }

  /**
   * Calls onDestroy on all created instances in reverse creation order.
   */
  public async destroy(): Promise<void> {
    if (this._isDestroyed) {
      return;
    }

    this._isDestroyed = true;
    const errors: Error[] = [];

    // Destroy in reverse creation order
    for (const token of [...this.creationOrder].reverse()) {
      try {
        // Check if it was a scoped factory with onDestroy hook
        const factoryProvider = this.scopedFactoryProviders.get(token);

        if (factoryProvider?.onDestroy) {
          const hookDeps = factoryProvider.onDestroy.deps ?? [];
          const resolvedDeps = await Promise.all(
            hookDeps.map((dep: Token<unknown>) => this.resolve(dep))
          );
          await factoryProvider.onDestroy.handler(...resolvedDeps);
          continue;
        }

        // For scoped class instances, call onDestroy if implemented
        const instance = this.instances.get(token);

        if (hasOnDestroy(instance)) {
          await instance.onDestroy();
        }
      } catch (error) {
        errors.push(error as Error);
      }
    }

    this.instances.clear();
    this.creationOrder.length = 0;

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Errors during scope destruction');
    }
  }

  private async createScopedClassInstance<T>(token: Token<T>): Promise<T> {
    const registration = this.scopedClassProviders.get(token)!;
    const resolvedDeps = await Promise.all(registration.deps.map((dep) => this.resolve(dep)));
    const instance = new registration.Class(...resolvedDeps) as T;

    this.instances.set(token, instance);
    this.creationOrder.push(token);

    // Call onInit if implemented
    if (hasOnInit(instance)) {
      await instance.onInit();
    }

    return instance;
  }

  private async createScopedFactoryInstance<T>(token: Token<T>): Promise<T> {
    const provider = this.scopedFactoryProviders.get(token)!;
    const resolvedDeps = await Promise.all(
      provider.deps.map((dep: Token<unknown>) => this.resolve(dep))
    );
    const instance = await provider.factory(...resolvedDeps);

    this.instances.set(token, instance);
    this.creationOrder.push(token);

    return instance;
  }

  /**
   * Internal resolution logic shared by get() and dependency resolution.
   * Does not check if scope is destroyed - caller must handle that.
   */
  private async resolve<T>(token: Token<T>): Promise<T> {
    // Check if already cached in this scope
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    // Check if it's a scoped class
    if (this.scopedClassProviders.has(token)) {
      return this.createScopedClassInstance(token);
    }

    // Check if it's a scoped factory
    if (this.scopedFactoryProviders.has(token)) {
      return this.createScopedFactoryInstance(token);
    }

    // Fall back to parent container
    if (this.parentInstances.has(token)) {
      return this.parentInstances.get(token) as T;
    }

    throw new Error(`Token not registered: ${tokenToString(token)}`);
  }
}
