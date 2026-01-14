import { describe, it, expect } from 'vitest';
import { ContainerBuilder } from './container-builder.js';
import type { OnDestroy, OnInit } from './types/lifecycle.js';
import { Scope } from './types/scope.js';
import { createToken } from './utils/create-token.js';
import { defineFactory } from './utils/define-factory.js';

describe('dependency resolution', () => {
  it('should allow scoped class to depend on singleton', async () => {
    class SingletonService {
      public static readonly deps = [] as const;
    }

    class ScopedService {
      public static readonly deps = [SingletonService] as const;
      public constructor(public readonly singleton: SingletonService) {}
    }

    const container = await new ContainerBuilder()
      .registerClass(SingletonService)
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    const scoped = await scope.getScoped(ScopedService);

    expect(scoped.singleton).toBe(container.get(SingletonService));
  });

  it('should allow scoped class to depend on other scoped class', async () => {
    class ScopedA {
      public static readonly deps = [] as const;
    }

    class ScopedB {
      public static readonly deps = [ScopedA] as const;
      public constructor(public readonly a: ScopedA) {}
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedA, { scope: Scope.Scoped })
      .registerClass(ScopedB, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    const scopedB = await scope.getScoped(ScopedB);

    expect(scopedB.a).toBe(await scope.getScoped(ScopedA));
  });

  it('should throw at build time if singleton depends on scoped', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    class SingletonService {
      public static readonly deps = [ScopedService] as const;
      public constructor(_scoped: ScopedService) {}
    }

    const builder = new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .registerClass(SingletonService);

    await expect(builder.build()).rejects.toThrow(
      'singleton SingletonService cannot depend on scoped ScopedService'
    );
  });

  it('should allow scope.get() to retrieve singletons from parent container', async () => {
    class SingletonService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder().registerClass(SingletonService).build();

    const scope = container.createScope();

    expect(scope.get(SingletonService)).toBe(container.get(SingletonService));
  });

  it('should throw when scope.get() is called with a scoped token', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();

    expect(() => scope.get(ScopedService)).toThrow(
      'Token ScopedService is a scoped provider. Use getScoped() instead of get().'
    );
  });

  it('should throw when scope.getScoped() is called with a singleton token', async () => {
    class SingletonService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder().registerClass(SingletonService).build();

    const scope = container.createScope();

    await expect(scope.getScoped(SingletonService)).rejects.toThrow(
      'Token SingletonService is a singleton. Use get() instead of getScoped().'
    );
  });
});

describe('lifecycle', () => {
  it('should call onInit when scoped class is instantiated', async () => {
    let initCalled = false;

    class ScopedService implements OnInit {
      public static readonly deps = [] as const;
      public async onInit() {
        initCalled = true;
      }
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    await scope.getScoped(ScopedService);

    expect(initCalled).toBe(true);
  });

  it('should call onDestroy in reverse creation order on scope.destroy()', async () => {
    const order: string[] = [];

    class ScopedA implements OnDestroy {
      public static readonly deps = [] as const;
      public async onDestroy() {
        order.push('A');
      }
    }

    class ScopedB implements OnDestroy {
      public static readonly deps = [ScopedA] as const;
      public constructor(_a: ScopedA) {}
      public async onDestroy() {
        order.push('B');
      }
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedA, { scope: Scope.Scoped })
      .registerClass(ScopedB, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    await scope.getScoped(ScopedB); // Creates ScopedA first, then ScopedB
    await scope.destroy();

    expect(order).toEqual(['B', 'A']);
  });

  it('should call scoped factory onDestroy hook on scope.destroy()', async () => {
    const REQUEST_DATA = createToken<{ id: string }>('REQUEST_DATA');

    let destroyCalled = false;

    const factory = defineFactory({
      provide: REQUEST_DATA,
      deps: [] as const,
      factory: () => ({ id: 'test' }),
      onDestroy: {
        deps: [REQUEST_DATA] as const,
        handler: (data) => {
          destroyCalled = true;
          expect(data.id).toBe('test');
        },
      },
    });

    const container = await new ContainerBuilder()
      .registerFactory(factory, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    await scope.getScoped(REQUEST_DATA);
    await scope.destroy();

    expect(destroyCalled).toBe(true);
  });

  it('should NOT affect singleton instances on scope.destroy()', async () => {
    let singletonDestroyed = false;

    class SingletonService implements OnDestroy {
      public static readonly deps = [] as const;
      public async onDestroy() {
        singletonDestroyed = true;
      }
    }

    class ScopedService {
      public static readonly deps = [SingletonService] as const;
      public constructor(public readonly singleton: SingletonService) {}
    }

    const container = await new ContainerBuilder()
      .registerClass(SingletonService)
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    await scope.getScoped(ScopedService);
    await scope.destroy();

    expect(singletonDestroyed).toBe(false);
    expect(container.get(SingletonService)).toBeInstanceOf(SingletonService);
  });

  it('should reject if getScoped() called on destroyed scope', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    await scope.destroy();

    await expect(scope.getScoped(ScopedService)).rejects.toThrow('Scope has been destroyed');
  });

  it('should throw if get() called on destroyed scope', async () => {
    class SingletonService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder().registerClass(SingletonService).build();

    const scope = container.createScope();
    await scope.destroy();

    expect(() => scope.get(SingletonService)).toThrow('Scope has been destroyed');
  });

  it('should set isDestroyed to true after destroy()', async () => {
    const container = await new ContainerBuilder().build();

    const scope = container.createScope();
    expect(scope.isDestroyed).toBe(false);

    await scope.destroy();
    expect(scope.isDestroyed).toBe(true);
  });

  it('should handle multiple destroy() calls gracefully', async () => {
    const container = await new ContainerBuilder().build();

    const scope = container.createScope();
    await scope.destroy();
    await scope.destroy(); // Should not throw

    expect(scope.isDestroyed).toBe(true);
  });
});

describe('Multiple scopes', () => {
  it('should support multiple simultaneous scopes', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
      public value = Math.random();
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope1 = container.createScope();
    const scope2 = container.createScope();
    const scope3 = container.createScope();

    const instance1 = await scope1.getScoped(ScopedService);
    const instance2 = await scope2.getScoped(ScopedService);
    const instance3 = await scope3.getScoped(ScopedService);

    // All different instances
    expect(instance1).not.toBe(instance2);
    expect(instance2).not.toBe(instance3);
    expect(instance1).not.toBe(instance3);

    // Each scope maintains its own instance
    expect(await scope1.getScoped(ScopedService)).toBe(instance1);
    expect(await scope2.getScoped(ScopedService)).toBe(instance2);
  });

  it('should allow independent scope destruction', async () => {
    const destroyOrder: string[] = [];

    class ScopedService implements OnDestroy {
      public static readonly deps = [] as const;
      public name = '';
      public async onDestroy() {
        destroyOrder.push(this.name);
      }
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope1 = container.createScope();
    const scope2 = container.createScope();

    (await scope1.getScoped(ScopedService)).name = 'scope1';
    (await scope2.getScoped(ScopedService)).name = 'scope2';

    await scope1.destroy();

    expect(destroyOrder).toEqual(['scope1']);
    expect(scope2.isDestroyed).toBe(false);
    expect((await scope2.getScoped(ScopedService)).name).toBe('scope2');
  });
});

describe('Scoped edge cases', () => {
  it('should handle scoped provider with no dependencies', async () => {
    class SimpleScoped {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder()
      .registerClass(SimpleScoped, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    expect(await scope.getScoped(SimpleScoped)).toBeInstanceOf(SimpleScoped);
  });

  it('should reject for unregistered token in scope.get()', async () => {
    const UNREGISTERED = createToken<string>('UNREGISTERED');

    const container = await new ContainerBuilder().build();
    const scope = container.createScope();

    expect(() => scope.get(UNREGISTERED)).toThrow('Token not registered');
  });

  it('should reject for unregistered token in scope.getScoped()', async () => {
    const UNREGISTERED = createToken<string>('UNREGISTERED');

    const container = await new ContainerBuilder().build();
    const scope = container.createScope();

    await expect(scope.getScoped(UNREGISTERED)).rejects.toThrow('Token not registered');
  });

  it('should handle circular dependency detection for scoped providers', async () => {
    class ScopedA {
      public static deps: readonly [typeof ScopedB];
      public constructor(_b: ScopedB) {}
    }
    class ScopedB {
      public static deps: readonly [typeof ScopedA];
      public constructor(_a: ScopedA) {}
    }
    ScopedA.deps = [ScopedB] as const;
    ScopedB.deps = [ScopedA] as const;

    const builder = new ContainerBuilder()
      .registerClass(ScopedA, { scope: Scope.Scoped })
      .registerClass(ScopedB, { scope: Scope.Scoped });

    await expect(builder.build()).rejects.toThrow('Circular dependency');
  });

  it('should allow override() to work with scoped registrations', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
      public value = 'original';
    }

    const mockScoped = { value: 'mocked' };

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .override(ScopedService, mockScoped as unknown as ScopedService)
      .build();

    // After override, it becomes a value (singleton)
    expect(container.get(ScopedService)).toBe(mockScoped);
  });

  it('should handle merge() with scoped registrations', async () => {
    const CONFIG = createToken<{ value: string }>('CONFIG');

    class ScopedService {
      public static readonly deps = [] as const;
    }

    const builder1 = new ContainerBuilder().registerClass(ScopedService, {
      scope: Scope.Scoped,
    });
    const builder2 = new ContainerBuilder().registerValue(CONFIG, { value: 'test' });

    const container = await builder2.merge(builder1).build();
    const scope = container.createScope();

    expect(await scope.getScoped(ScopedService)).toBeInstanceOf(ScopedService);
    expect(container.get(CONFIG)).toEqual({ value: 'test' });
  });

  it('should collect errors during scope destruction', async () => {
    class FailingService implements OnDestroy {
      public static readonly deps = [] as const;
      public async onDestroy() {
        throw new Error('destroy failed');
      }
    }

    const container = await new ContainerBuilder()
      .registerClass(FailingService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    await scope.getScoped(FailingService);

    await expect(scope.destroy()).rejects.toThrow(AggregateError);
  });
});
