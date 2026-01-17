import { Container, ContainerState } from './container.js';
import type { FactoryProvider } from './types/factory-provider.js';
import type { InjectableClass } from './types/injectable-class.js';
import type { RegistrationOptions } from './types/options.js';
import { Scope } from './types/scope.js';
import type { Token } from './types/tokens.js';
import { tokenToString } from './utils/token-to-string.js';

/**
 * ContainerBuilder is the class you use to configure a Container.
 *
 * The ContainerBuilder has 2 main responsibilities:
 *   1. Collect all provider registrations, which can be defined in any order.
 *     - Handled by register* methods.
 *   2. Instantiate instances and register them in a new Container.
 *     - Handled by `.build()`.
 *
 * The ContainerBuilder does a topological sort to ensure that instances are created and destroyed
 * in the correct order (e.g. all of a providers dependencies must be created before that
 * provider's instance can be created, and destruction needs to happen in the opposite order).
 */
export class ContainerBuilder {
  private readonly registrations: Map<Token<unknown>, Registration> = new Map();

  /**
   * Register a static value.
   */
  public registerValue<T>(token: Token<T>, value: T): this {
    this.addRegistration(token, { type: 'value', scope: Scope.Singleton, token, value });
    return this;
  }

  /**
   * Register a class with static deps property.
   * Dependencies are resolved automatically during build().
   * Type safety between the deps array and constructor params is enforced at this method.
   */
  public registerClass<T, Deps extends readonly Token<any>[] = readonly []>(
    Class: InjectableClass<T, Deps>,
    options?: RegistrationOptions
  ): this {
    const token = Class as Token<T>;
    this.addRegistration(token, {
      type: 'class',
      scope: options?.scope ?? Scope.Singleton,
      token,
      Class,
      deps: Class.deps ?? [],
    });
    return this;
  }

  /**
   * Register a factory provider, which can be async or sync and can inject other dependencies.
   */
  public registerFactory<
    T,
    Deps extends readonly Token<any>[],
    DestroyDeps extends readonly Token<any>[],
  >(provider: FactoryProvider<T, Deps, DestroyDeps>, options?: RegistrationOptions): this {
    const token = provider.provide;
    this.addRegistration(token, {
      type: 'factory',
      scope: options?.scope ?? Scope.Singleton,
      token,
      provider,
      deps: provider.deps,
    });
    return this;
  }

  /**
   * Merge providers from another container.
   *
   * This is useful for creating standalone packages/libraries that export a ContainerBuilder.
   * You can use `merge` to bring these standalone packages together into a single Container.
   */
  public merge(other: ContainerBuilder): this {
    for (const [token, registration] of other.registrations) {
      this.addRegistration(token, registration);
    }
    return this;
  }

  /**
   * Check if a token has been registered.
   */
  public has(token: Token<unknown>): boolean {
    return this.registrations.has(token);
  }

  /**
   * Override an existing provider with a value; intended for mocking during tests.
   * Only works for singleton providers. For scoped providers, use overrideFactory instead.
   */
  public overrideValue<T>(token: Token<T>, value: T): this {
    const existing = this.assertTokenRegistered(token);
    if (existing.scope === Scope.Scoped) {
      throw new Error(
        `Cannot use overrideValue on scoped provider ${tokenToString(token)}. Use overrideFactory instead.`
      );
    }
    this.registrations.set(token, { type: 'value', scope: Scope.Singleton, token, value });
    return this;
  }

  /**
   * Override an existing provider with a class; intended for mocking during tests.
   * Preserves the original provider's scope.
   */
  public overrideClass<T, Deps extends readonly Token<any>[] = readonly []>(
    token: Token<T>,
    Class: InjectableClass<T, Deps>
  ): this {
    const existing = this.assertTokenRegistered(token);
    this.registrations.set(token, {
      type: 'class',
      scope: existing.scope,
      token,
      Class,
      deps: Class.deps ?? [],
    });
    return this;
  }

  /**
   * Override an existing provider with a factory; intended for mocking during tests.
   * Preserves the original provider's scope.
   */
  public overrideFactory<
    T,
    Deps extends readonly Token<any>[],
    DestroyDeps extends readonly Token<any>[],
  >(provider: FactoryProvider<T, Deps, DestroyDeps>): this {
    const token = provider.provide;
    const existing = this.assertTokenRegistered(token);
    this.registrations.set(token, {
      type: 'factory',
      scope: existing.scope,
      token,
      provider,
      deps: provider.deps,
    });
    return this;
  }

  private assertTokenRegistered(token: Token<unknown>): Registration {
    const existing = this.registrations.get(token);
    if (!existing) {
      throw new Error(`Cannot override: ${tokenToString(token)} is not registered`);
    }
    return existing;
  }

  /**
   * Build the container - topologically sorts providers and instantiates singletons.
   * Scoped providers are validated but not instantiated - they're stored for later use in Scopes.
   * By default, also initializes the container (calls onInit on all services).
   */
  public async build(options?: { init?: boolean }): Promise<Container> {
    const sorted = this.topologicalSort();

    // Build the state that Container needs
    const state: ContainerState = {
      instances: new Map(),
      factoryProviders: new Map(),
      valueProviders: new Set(),
      initOrder: [],
      scopedClassProviders: new Map(),
      scopedFactoryProviders: new Map(),
    };

    for (const token of sorted) {
      const registration = this.registrations.get(token)!;

      switch (registration.type) {
        case 'value': {
          state.instances.set(token, registration.value);
          state.valueProviders.add(token);
          state.initOrder.push(token);
          break;
        }
        case 'class': {
          if (registration.scope === Scope.Scoped) {
            // Store registration data for scope creation - don't instantiate
            state.scopedClassProviders.set(token, {
              Class: registration.Class,
              deps: registration.deps,
            });
          } else {
            const resolvedDeps = this.resolveDeps(registration.deps, state.instances);
            const instance = new registration.Class(...resolvedDeps);
            state.instances.set(token, instance);
            state.initOrder.push(token);
          }
          break;
        }
        case 'factory': {
          if (registration.scope === Scope.Scoped) {
            // Store registration data for scope creation - don't instantiate
            state.scopedFactoryProviders.set(token, registration.provider);
          } else {
            const resolvedDeps = this.resolveDeps(registration.deps, state.instances);
            const instance = await registration.provider.factory(...resolvedDeps);
            state.instances.set(token, instance);
            state.factoryProviders.set(token, registration.provider);
            state.initOrder.push(token);
          }
          break;
        }
      }
    }

    const container = new Container(state);

    if (options?.init !== false) {
      await container.init();
    }

    return container;
  }

  /**
   * Topologically sort providers by their dependencies using Kahn's algorithm.
   *
   * This ensures that dependent providers are created and initialized BEFORE the providers that
   * depend on them, and that dependent providers are destroyed AFTER providers that depend on them.
   *
   * Also validates that singleton providers do not depend on scoped providers.
   */
  private topologicalSort(): Token<unknown>[] {
    // inDegree tracks the number of dependencies a given token has.
    const inDegree = new Map<Token<unknown>, number>();

    const dependents = new Map<Token<unknown>, Set<Token<unknown>>>();

    // Initialize all nodes.
    for (const token of this.registrations.keys()) {
      inDegree.set(token, 0);
      dependents.set(token, new Set());
    }

    // Build graph edges (dependents and inDegree maps).
    for (const [token, registration] of this.registrations) {
      if (!('deps' in registration)) {
        continue;
      }

      const seenDeps = new Set<Token<unknown>>();

      for (const dep of registration.deps) {
        // Check for duplicate dependencies
        if (seenDeps.has(dep)) {
          const dependent = tokenToString(token);
          const dependency = tokenToString(dep);

          throw new Error(
            `Duplicate dependency: ${dependent} depends on ${dependency} multiple times`
          );
        }
        seenDeps.add(dep);

        if (!this.registrations.has(dep)) {
          const dependent = tokenToString(token);
          const dependency = tokenToString(dep);

          throw new Error(
            `Missing dependency: ${dependent} depends on ${dependency}, which is not registered`
          );
        }

        // Validate: singleton cannot depend on scoped
        const depRegistration = this.registrations.get(dep)!;
        if (this.isSingleton(registration) && this.isScoped(depRegistration)) {
          throw new Error(
            `Invalid dependency: singleton ${tokenToString(token)} cannot depend on scoped ${tokenToString(dep)}`
          );
        }

        // dep -> token (token depends on dep)
        dependents.get(dep)!.add(token);
        inDegree.set(token, (inDegree.get(token) ?? 0) + 1);
      }
    }

    // Start with nodes that have no dependencies
    const queue: Token<unknown>[] = [];
    for (const [token, degree] of inDegree) {
      if (degree === 0) {
        queue.push(token);
      }
    }

    const sorted: Token<unknown>[] = [];

    // Iteratively push tokens that have no unsorted dependencies to the sorted list.
    // When a token is pushed, we reduce the inDegree for any dependent providers.
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      // Reduce in-degree of dependents.
      for (const dependent of dependents.get(current) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // Check for circular dependencies.
    if (sorted.length !== this.registrations.size) {
      const cyclePath = this.findCyclePath();
      const cycleStr = cyclePath.map((t) => tokenToString(t)).join(' -> ');

      throw new Error(`Circular dependency detected: ${cycleStr}`);
    }

    return sorted;
  }

  /**
   * Find a cycle path using DFS with coloring.
   * Returns the cycle as an array of tokens ending with the repeated token.
   */
  private findCyclePath(): Token<unknown>[] {
    const WHITE = 0; // Unvisited
    const GRAY = 1; // Currently visiting (in stack)
    const BLACK = 2; // Finished visiting

    const color = new Map<Token<unknown>, number>();

    for (const token of this.registrations.keys()) {
      color.set(token, WHITE);
    }

    const path: Token<unknown>[] = [];

    const dfs = (token: Token<unknown>): Token<unknown>[] | null => {
      color.set(token, GRAY);
      path.push(token);

      const registration = this.registrations.get(token);
      const deps = registration && 'deps' in registration ? registration.deps : [];

      for (const dep of deps) {
        if (color.get(dep) === GRAY) {
          // Found cycle - return path from dep to current + dep again
          const cycleStart = path.indexOf(dep);
          return [...path.slice(cycleStart), dep];
        }
        if (color.get(dep) === WHITE) {
          const cycle = dfs(dep);
          if (cycle) {
            return cycle;
          }
        }
      }

      color.set(token, BLACK);
      path.pop();
      return null;
    };

    for (const token of this.registrations.keys()) {
      if (color.get(token) === WHITE) {
        const cycle = dfs(token);
        if (cycle) {
          return cycle;
        }
      }
    }

    return []; // Should not reach here if called after detecting a cycle
  }

  private addRegistration(token: Token<unknown>, registration: Registration): void {
    const existing = this.registrations.get(token);
    if (existing !== undefined) {
      // If this registration already exists by reference, it means that a ContainerBuilder was
      // merged in multiple times. We want to allow this to support diamond dependency patterns.
      if (existing === registration) {
        return;
      }
      throw new Error(`Token already registered: ${tokenToString(token)}`);
    }
    this.registrations.set(token, registration);
  }

  private isScoped(registration: Registration): boolean {
    return registration.scope === Scope.Scoped;
  }

  private isSingleton(registration: Registration): boolean {
    return registration.scope === Scope.Singleton;
  }

  /**
   * Resolve dependencies from the instances map.
   */
  private resolveDeps(
    deps: readonly Token<unknown>[],
    instances: Map<Token<unknown>, unknown>
  ): unknown[] {
    return deps.map((dep) => {
      const instance = instances.get(dep);
      if (instance === undefined) {
        throw new Error(`Dependency not found: ${tokenToString(dep)}`);
      }
      return instance;
    });
  }
}

type Registration<T = unknown> =
  | ValueRegistration<T>
  | ClassRegistration<T>
  | FactoryRegistration<T>;

interface ValueRegistration<T> {
  type: 'value';
  scope: typeof Scope.Singleton;
  token: Token<T>;
  value: T;
}

interface ClassRegistration<T> {
  type: 'class';
  scope: Scope;
  token: Token<T>;
  Class: InjectableClass<T, readonly Token<any>[]>;
  deps: readonly Token<unknown>[];
}

interface FactoryRegistration<T> {
  type: 'factory';
  scope: Scope;
  token: Token<T>;
  provider: FactoryProvider<T, any, any>;
  deps: readonly Token<unknown>[];
}
