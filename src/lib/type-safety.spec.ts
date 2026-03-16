import { describe, it } from 'vitest';
import { ContainerBuilder } from './container-builder.js';
import { createToken } from './utils/create-token.js';
import { defineFactory } from './utils/define-factory.js';

describe('Type safety', () => {
  describe('ContainerBuilder', () => {
    it('registerClass should enforce deps matching constructor parameters', async () => {
      const CONFIG = createToken<{ value: string }>('CONFIG');

      class BadService {
        public static readonly deps = [CONFIG] as const;
        public constructor(_config: number) {}
      }

      await new ContainerBuilder()
        .registerValue(CONFIG, { value: 'test' })
        // @ts-expect-error - constructor parameter doesn't match deps type
        .registerClass(BadService)
        .build();
    });

    it('registerClass should catch when constructor has more params than deps', async () => {
      const CONFIG = createToken<{ value: string }>('CONFIG');

      class BadService {
        public static readonly deps = [CONFIG] as const;
        public constructor(_config: { value: string }, _extra: number) {}
      }

      await new ContainerBuilder()
        .registerValue(CONFIG, { value: 'test' })
        // @ts-expect-error - constructor has 2 params but deps only provides 1
        .registerClass(BadService)
        .build();
    });

    it('registerClass should catch when constructor has fewer params than deps', async () => {
      const CONFIG = createToken<{ value: string }>('CONFIG');
      const LOGGER = createToken<{ log: () => void }>('LOGGER');

      class BadService {
        public static readonly deps = [CONFIG, LOGGER] as const;
        public constructor(_config: { value: string }) {}
      }

      await new ContainerBuilder()
        .registerValue(CONFIG, { value: 'test' })
        .registerValue(LOGGER, { log: () => {} })
        // @ts-expect-error - constructor has 1 param but deps provides 2
        .registerClass(BadService)
        .build();
    });

    it('registerClass should enforce deps matching constructor parameters for class-based dependencies', async () => {
      class ServiceA {
        public static readonly deps = [] as const;
      }

      class ServiceB {
        public readonly b = 'b';
        public static readonly deps = [] as const;
      }

      class BadService {
        public static readonly deps = [ServiceA] as const;
        public constructor(_serviceA: ServiceB) {}
      }

      await new ContainerBuilder()
        .registerClass(ServiceA)
        .registerClass(ServiceB)
        // @ts-expect-error - constructor parameter doesn't match deps type (expected ServiceA, got string)
        .registerClass(BadService)
        .build();
    });
  });

  describe('Container', () => {
    it('container.get should return typed value', async () => {
      const CONFIG = createToken<{ value: string }>('CONFIG');

      const container = await new ContainerBuilder()
        .registerValue(CONFIG, { value: 'test' })
        .build();

      const config = container.get(CONFIG);
      // @ts-expect-error - config.value is string, not number
      void (config.value as number);
    });
  });

  describe('defineFactory', () => {
    it('should enforce deps matching factory parameters', () => {
      const DATABASE = createToken<{ connection: string }>('DATABASE');
      const CONFIG = createToken<{ value: string }>('CONFIG');

      defineFactory({
        provide: DATABASE,
        deps: [CONFIG] as const,
        // @ts-expect-error - factory parameter type doesn't match deps
        factory: (_wrongType: string) => ({ connection: 'test' }),
      });
    });

    it('should enforce onDestroy handler parameters match deps', () => {
      const DATABASE = createToken<{ connection: string }>('DATABASE');
      const CONFIG = createToken<{ value: string }>('CONFIG');

      defineFactory({
        provide: DATABASE,
        deps: [CONFIG] as const,
        factory: (_config) => ({ connection: 'test' }),
        onDestroy: {
          deps: [DATABASE] as const,
          // @ts-expect-error - handler parameter type doesn't match onDestroy deps
          handler: (_wrongType: number) => {},
        },
      });
    });
  });
});
