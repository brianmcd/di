import { describe, it, expect } from 'vitest';
import { ContainerBuilder } from './container-builder.js';
import type { OnDestroy, OnInit } from './types/lifecycle.js';
import { createToken } from './utils/create-token.js';
import { defineFactory } from './utils/define-factory.js';

const CONFIG = createToken<{ value: string }>('CONFIG');
const DATABASE = createToken<{ connection: string }>('DATABASE');

class ServiceWithLifecycle implements OnInit, OnDestroy {
  public static readonly deps = [] as const;
  public initCalled = false;
  public destroyCalled = false;

  public async onInit(): Promise<void> {
    this.initCalled = true;
  }

  public async onDestroy(): Promise<void> {
    this.destroyCalled = true;
  }
}

describe('lifecycle', () => {
  it('should call onInit in registration order', async () => {
    const order: string[] = [];

    class First implements OnInit {
      public static readonly deps = [] as const;
      public async onInit() {
        order.push('first');
      }
    }

    class Second implements OnInit {
      public static readonly deps = [First] as const;
      public constructor(_first: First) {}
      public async onInit() {
        order.push('second');
      }
    }

    await new ContainerBuilder().registerClass(First).registerClass(Second).build();

    expect(order).toEqual(['first', 'second']);
  });

  it('should throw if init() is called twice', async () => {
    const container = await new ContainerBuilder()
      .registerClass(ServiceWithLifecycle)
      .build({ init: false });

    await container.init();
    await expect(container.init()).rejects.toThrow('Container already initialized');
  });

  it('should call onDestroy in reverse registration order', async () => {
    const order: string[] = [];

    class First implements OnDestroy {
      public static readonly deps = [] as const;
      public async onDestroy() {
        order.push('first');
      }
    }

    class Second implements OnDestroy {
      public static readonly deps = [First] as const;
      public constructor(_first: First) {}
      public async onDestroy() {
        order.push('second');
      }
    }

    const container = await new ContainerBuilder()
      .registerClass(First)
      .registerClass(Second)
      .build();

    await container.destroy();

    expect(order).toEqual(['second', 'first']);
  });

  it('should collect errors during destroy and throw AggregateError', async () => {
    class FailingService implements OnDestroy {
      public static readonly deps = [] as const;
      public async onDestroy() {
        throw new Error('destroy failed');
      }
    }

    const container = await new ContainerBuilder().registerClass(FailingService).build();

    await expect(container.destroy()).rejects.toThrow(AggregateError);
  });

  it('should interleave factory onDestroy with class onDestroy', async () => {
    const order: string[] = [];

    class ServiceFirst implements OnDestroy {
      public static readonly deps = [] as const;
      public async onDestroy() {
        order.push('class-first');
      }
    }

    const factory = defineFactory({
      provide: DATABASE,
      deps: [ServiceFirst] as const,
      factory: () => ({ connection: 'test' }),
      onDestroy: {
        deps: [] as const,
        handler: () => {
          order.push('factory');
        },
      },
    });

    class ServiceLast implements OnDestroy {
      public static readonly deps = [DATABASE] as const;
      public constructor(_db: { connection: string }) {}
      public async onDestroy() {
        order.push('class-last');
      }
    }

    const container = await new ContainerBuilder()
      .registerClass(ServiceFirst)
      .registerFactory(factory)
      .registerClass(ServiceLast)
      .build();

    await container.destroy();

    expect(order).toEqual(['class-last', 'factory', 'class-first']);
  });

  it('should NOT call onInit on value-provided instances', async () => {
    const valueWithLifecycle = {
      value: 'test',
      onInit: () => {
        throw new Error('onInit should not be called on values');
      },
    };

    const container = await new ContainerBuilder()
      .registerValue(CONFIG, valueWithLifecycle as unknown as { value: string })
      .build();

    // If we got here without throwing, onInit was correctly skipped
    expect(container.get(CONFIG)).toBe(valueWithLifecycle);
    await container.destroy();
  });

  it('should NOT call onDestroy on value-provided instances', async () => {
    const valueWithLifecycle = {
      value: 'test',
      onDestroy: () => {
        throw new Error('onDestroy should not be called on values');
      },
    };

    const container = await new ContainerBuilder()
      .registerValue(CONFIG, valueWithLifecycle as unknown as { value: string })
      .build();

    // If we got here without throwing, onDestroy was correctly skipped
    await container.destroy();
  });

  it('should NOT call onInit on factory-provided instances', async () => {
    const factory = defineFactory({
      provide: DATABASE,
      deps: [] as const,
      factory: () => ({
        connection: 'test',
        onInit: () => {
          throw new Error('onInit should not be called on factory instances');
        },
      }),
    });

    const container = await new ContainerBuilder().registerFactory(factory).build();

    // If we got here without throwing, onInit was correctly skipped
    expect(container.get(DATABASE).connection).toBe('test');
  });
});

describe('get', () => {
  it('should throw for unregistered token', async () => {
    const container = await new ContainerBuilder().build();

    expect(() => container.get(CONFIG)).toThrow('Token not registered');
  });

  it('should throw if called before init', async () => {
    const container = await new ContainerBuilder()
      .registerValue(CONFIG, { value: 'test' })
      .build({ init: false });

    expect(() => container.get(CONFIG)).toThrow('Container not initialized');
  });
});
