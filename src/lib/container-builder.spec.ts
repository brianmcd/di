import { describe, it, expect } from 'vitest';
import { ContainerBuilder } from './container-builder.js';
import { Scope } from './types/scope.js';
import { createToken } from './utils/create-token.js';
import { defineFactory } from './utils/define-factory.js';

const CONFIG = createToken<{ value: string }>('CONFIG');
const DATABASE = createToken<{ connection: string }>('DATABASE');

class ServiceA {}

class ServiceB {
  public static readonly deps = [ServiceA] as const;
  public constructor(public readonly serviceA: ServiceA) {}
}

class ServiceC {
  public static readonly deps = [ServiceB] as const;
  public constructor(public readonly serviceB: ServiceB) {}
}

describe('registerValue', () => {
  it('should register and retrieve a value', async () => {
    const container = await new ContainerBuilder().registerValue(CONFIG, { value: 'test' }).build();

    expect(container.get(CONFIG)).toEqual({ value: 'test' });
  });

  it('should throw on duplicate registration', () => {
    const builder = new ContainerBuilder().registerValue(CONFIG, { value: 'test' });

    expect(() => builder.registerValue(CONFIG, { value: 'other' })).toThrow(
      'Token already registered'
    );
  });
});

describe('registerClass', () => {
  it('should register a class without deps property', async () => {
    class NoDepsService {}

    const container = await new ContainerBuilder().registerClass(NoDepsService).build();

    expect(container.get(NoDepsService)).toBeInstanceOf(NoDepsService);
  });

  it('should register a class with no dependencies', async () => {
    const container = await new ContainerBuilder().registerClass(ServiceA).build();

    expect(container.get(ServiceA)).toBeInstanceOf(ServiceA);
  });

  it('should inject dependencies into class constructor', async () => {
    const container = await new ContainerBuilder()
      .registerClass(ServiceA)
      .registerClass(ServiceB)
      .build();

    const serviceB = container.get(ServiceB);
    expect(serviceB.serviceA).toBeInstanceOf(ServiceA);
  });

  it('should resolve deep dependency chains', async () => {
    const container = await new ContainerBuilder()
      .registerClass(ServiceA)
      .registerClass(ServiceB)
      .registerClass(ServiceC)
      .build();

    const serviceC = container.get(ServiceC);
    expect(serviceC.serviceB.serviceA).toBeInstanceOf(ServiceA);
  });

  it('should throw on missing dependency', async () => {
    const builder = new ContainerBuilder().registerClass(ServiceB);

    await expect(builder.build()).rejects.toThrow('Missing dependency');
  });

  it('should throw on circular dependency with cycle path', async () => {
    // Define classes first, then set deps to avoid JS initialization order issues
    class CircularA {
      public static deps: readonly [typeof CircularB];
      public constructor(public b: CircularB) {}
    }
    class CircularB {
      public static deps: readonly [typeof CircularA];
      public constructor(public a: CircularA) {}
    }
    CircularA.deps = [CircularB] as const;
    CircularB.deps = [CircularA] as const;

    const builder = new ContainerBuilder().registerClass(CircularA).registerClass(CircularB);

    await expect(builder.build()).rejects.toThrow(
      'Circular dependency detected: CircularA -> CircularB -> CircularA'
    );
  });
});

describe('registerFactory', () => {
  it('should execute sync factory', async () => {
    const factory = defineFactory({
      provide: DATABASE,
      deps: [] as const,
      factory: () => ({ connection: 'postgres://localhost' }),
    });

    const container = await new ContainerBuilder().registerFactory(factory).build();

    expect(container.get(DATABASE)).toEqual({ connection: 'postgres://localhost' });
  });

  it('should execute async factory', async () => {
    const factory = defineFactory({
      provide: DATABASE,
      deps: [] as const,
      factory: async () => {
        await Promise.resolve();
        return { connection: 'postgres://localhost' };
      },
    });

    const container = await new ContainerBuilder().registerFactory(factory).build();

    expect(container.get(DATABASE)).toEqual({ connection: 'postgres://localhost' });
  });

  it('should inject dependencies into factory', async () => {
    const factory = defineFactory({
      provide: DATABASE,
      deps: [CONFIG] as const,
      factory: (config) => ({ connection: config.value }),
    });

    const container = await new ContainerBuilder()
      .registerValue(CONFIG, { value: 'from-config' })
      .registerFactory(factory)
      .build();

    expect(container.get(DATABASE)).toEqual({ connection: 'from-config' });
  });

  it('should call onDestroy hook when container is destroyed', async () => {
    let destroyCalled = false;

    const factory = defineFactory({
      provide: DATABASE,
      deps: [] as const,
      factory: () => ({ connection: 'test' }),
      onDestroy: {
        deps: [DATABASE] as const,
        handler: (db) => {
          destroyCalled = true;
          expect(db.connection).toBe('test');
        },
      },
    });

    const container = await new ContainerBuilder().registerFactory(factory).build();
    await container.destroy();

    expect(destroyCalled).toBe(true);
  });
});

describe('merge', () => {
  it('should merge registrations from another builder', async () => {
    const builder1 = new ContainerBuilder().registerValue(CONFIG, { value: 'config' });
    const builder2 = new ContainerBuilder().registerClass(ServiceA);

    const container = await builder1.merge(builder2).build();

    expect(container.get(CONFIG)).toEqual({ value: 'config' });
    expect(container.get(ServiceA)).toBeInstanceOf(ServiceA);
  });

  it('should throw on duplicate during merge', () => {
    const builder1 = new ContainerBuilder().registerValue(CONFIG, { value: 'one' });
    const builder2 = new ContainerBuilder().registerValue(CONFIG, { value: 'two' });

    expect(() => builder1.merge(builder2)).toThrow('Token already registered');
  });

  it('should allow merging the same builder twice (diamond pattern)', async () => {
    const shared = new ContainerBuilder().registerClass(ServiceA);
    const libB = new ContainerBuilder().merge(shared).registerValue(CONFIG, { value: 'B' });
    const libC = new ContainerBuilder().merge(shared);

    // Should not throw - ServiceA comes from same shared builder
    const container = await new ContainerBuilder().merge(libB).merge(libC).build();

    expect(container.get(ServiceA)).toBeInstanceOf(ServiceA);
  });

  it('should still throw when different builders register the same token independently', () => {
    const builder1 = new ContainerBuilder().registerClass(ServiceA);
    const builder2 = new ContainerBuilder().registerClass(ServiceA);

    expect(() => new ContainerBuilder().merge(builder1).merge(builder2)).toThrow(
      'Token already registered'
    );
  });
});

describe('override', () => {
  it('should override an existing value registration', async () => {
    const container = await new ContainerBuilder()
      .registerValue(CONFIG, { value: 'original' })
      .override(CONFIG, { value: 'mocked' })
      .build();

    expect(container.get(CONFIG)).toEqual({ value: 'mocked' });
  });

  it('should override an existing class registration', async () => {
    const mockServiceA = { mocked: true };

    const container = await new ContainerBuilder()
      .registerClass(ServiceA)
      .override(ServiceA, mockServiceA as unknown as ServiceA)
      .build();

    expect(container.get(ServiceA)).toBe(mockServiceA);
  });

  it('should override an existing factory registration', async () => {
    const factory = defineFactory({
      provide: DATABASE,
      deps: [] as const,
      factory: () => ({ connection: 'real-db' }),
    });

    const container = await new ContainerBuilder()
      .registerFactory(factory)
      .override(DATABASE, { connection: 'mock-db' })
      .build();

    expect(container.get(DATABASE)).toEqual({ connection: 'mock-db' });
  });

  it('should throw when overriding unregistered service', () => {
    const builder = new ContainerBuilder();

    expect(() => builder.override(CONFIG, { value: 'test' })).toThrow('Cannot override');
  });

  it('should work with merge() for test module pattern', async () => {
    // Simulate a "module" that registers multiple services
    const createModule = () =>
      new ContainerBuilder()
        .registerValue(CONFIG, { value: 'production' })
        .registerClass(ServiceA)
        .registerClass(ServiceB);

    // Test setup: merge module, then override specific services
    const mockServiceA = { mocked: true };
    const container = await new ContainerBuilder()
      .merge(createModule())
      .override(CONFIG, { value: 'test' })
      .override(ServiceA, mockServiceA as unknown as ServiceA)
      .build();

    // Overridden services return mocks
    expect(container.get(CONFIG)).toEqual({ value: 'test' });
    expect(container.get(ServiceA)).toBe(mockServiceA);

    // Non-overridden services use mock dependencies
    const serviceB = container.get(ServiceB);
    expect(serviceB.serviceA).toBe(mockServiceA);
  });
});

describe('registerClass with Scope.Scoped', () => {
  it('should NOT instantiate scoped class during build', async () => {
    let instanceCount = 0;

    class ScopedService {
      public static readonly deps = [] as const;

      public constructor() {
        instanceCount++;
      }
    }

    await new ContainerBuilder().registerClass(ScopedService, { scope: Scope.Scoped }).build();

    expect(instanceCount).toBe(0);
  });

  it('should create instance when scope.getScoped() is called', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    const instance = await scope.getScoped(ScopedService);

    expect(instance).toBeInstanceOf(ScopedService);
  });

  it('should cache instance within same scope', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    const instance1 = await scope.getScoped(ScopedService);
    const instance2 = await scope.getScoped(ScopedService);

    expect(instance1).toBe(instance2);
  });

  it('should create different instances in different scopes', async () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    const container = await new ContainerBuilder()
      .registerClass(ScopedService, { scope: Scope.Scoped })
      .build();

    const scope1 = container.createScope();
    const scope2 = container.createScope();

    expect(await scope1.getScoped(ScopedService)).not.toBe(await scope2.getScoped(ScopedService));
  });

  it('should throw on duplicate registration', () => {
    class ScopedService {
      public static readonly deps = [] as const;
    }

    const builder = new ContainerBuilder().registerClass(ScopedService, { scope: Scope.Scoped });

    expect(() => builder.registerClass(ScopedService, { scope: Scope.Scoped })).toThrow(
      'Token already registered'
    );
  });

  it('should throw on missing dependency at build time', async () => {
    const UNREGISTERED = createToken<string>('UNREGISTERED');

    class ScopedService {
      public static readonly deps = [UNREGISTERED] as const;
      public constructor(_value: string) {}
    }

    const builder = new ContainerBuilder().registerClass(ScopedService, { scope: Scope.Scoped });

    await expect(builder.build()).rejects.toThrow('Missing dependency');
  });
});

describe('registerFactory with Scope.Scoped', () => {
  it('should execute factory per-scope', async () => {
    const REQUEST_ID = createToken<string>('REQUEST_ID');
    let callCount = 0;

    const factory = defineFactory({
      provide: REQUEST_ID,
      deps: [] as const,
      factory: () => `request-${++callCount}`,
    });

    const container = await new ContainerBuilder()
      .registerFactory(factory, { scope: Scope.Scoped })
      .build();

    const scope1 = container.createScope();
    const scope2 = container.createScope();

    expect(await scope1.getScoped(REQUEST_ID)).toBe('request-1');
    expect(await scope2.getScoped(REQUEST_ID)).toBe('request-2');
    expect(await scope1.getScoped(REQUEST_ID)).toBe('request-1'); // Cached
  });

  it('should handle async scoped factory', async () => {
    const REQUEST_DATA = createToken<{ id: string }>('REQUEST_DATA');

    const factory = defineFactory({
      provide: REQUEST_DATA,
      deps: [] as const,
      factory: async () => {
        await Promise.resolve();
        return { id: 'async-result' };
      },
    });

    const container = await new ContainerBuilder()
      .registerFactory(factory, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();
    const result = await scope.getScoped(REQUEST_DATA);

    expect(result).toEqual({ id: 'async-result' });
  });

  it('should inject dependencies into scoped factory', async () => {
    const REQUEST_ID = createToken<string>('REQUEST_ID');

    const factory = defineFactory({
      provide: REQUEST_ID,
      deps: [CONFIG] as const,
      factory: (config) => `request-${config.value}`,
    });

    const container = await new ContainerBuilder()
      .registerValue(CONFIG, { value: 'test' })
      .registerFactory(factory, { scope: Scope.Scoped })
      .build();

    const scope = container.createScope();

    expect(await scope.getScoped(REQUEST_ID)).toBe('request-test');
  });
});
