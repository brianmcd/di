# @brianmcd/di

A lightweight, type-safe dependency injection container for Node.

[![npm version](https://badge.fury.io/js/@brianmcd%2Fdi.svg)](https://www.npmjs.com/package/@brianmcd/di)
[![CI](https://github.com/brianmcd/di/actions/workflows/ci.yml/badge.svg)](https://github.com/brianmcd/di/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Table of Contents

- [Motivation](#motivation)
- [Installation](#installation)
- [Example](#example)
- [Overview](#overview)
  - [Class Providers](#class-providers)
  - [Factory Providers](#factory-providers)
  - [Value Providers](#value-providers)
- [Scoped Containers](#scoped-containers)
- [Creating Reusable Packages](#creating-reusable-packages)
- [API Reference](#api-reference)
  - [ContainerBuilder](#containerbuilder)
  - [Container](#container)
  - [ScopedContainer](#scopedcontainer)
  - [Helper Functions](#helper-functions)
  - [Interfaces](#interfaces)
- [Testing](#testing)
- [Type Safety](#type-safety)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Motivation

Why yet another DI container for Node?

I couldn't find one with the following feature set:

- **No decorators**: I don't want to rely on experimental decorators, emitDecoratorMetadata, or reflect-metadata.
- **Async factories**: When using a factory provider, the factory needs to be able to be async.
- **Lifecycle hooks**: When providing a class, I want to be able to have async `onInit` and `onDestroy` methods so that I can do initialization and cleanup.
- **Scoped containers**: By default, providers create singletons, but sometimes you need things to be scoped in some way (e.g. request-scoped).
- **Type safety**: If I have a mismatch between what I've declared and what I'm using, I want a compiler error.

These are the core design goals of `@brianmcd/di`. Beyond these, the goal is to keep the library small and simple.

## Installation

```bash
npm install @brianmcd/di
```

## Example

```typescript
import { ContainerBuilder, OnInit, OnDestroy } from '@brianmcd/di';

class UserRepository implements OnInit, OnDestroy {
  public async onInit() {
    // Do some async or sync initialization, if you want.
  }

  public async onDestroy() {
    // Do some async or sync cleanup, if you want.
  }

  public async findById(id: string) {
    return { id, name: 'Alice' };
  }
}

class UserService {
  static readonly deps = [UserRepository] as const;

  constructor(private readonly userRepo: UserRepository) {}

  public async getUser(id: string) {
    return this.userRepo.findById(id);
  }
}

// Build the container - dependencies are resolved automatically and registration order doesn't matter.
const container = await new ContainerBuilder()
  .registerClass(UserRepository)
  .registerClass(UserService)
  .build();

// Use your services
const userService = container.get(UserService);
const user = await userService.getUser('123');
console.log(user); // { id: '123', name: 'Alice' }

// Cleanup - calls onDestroy in reverse order.
await container.destroy();
```

## Overview

To create a new `Container`, use the `ContainerBuilder`. The gist of it is that you register your providers with a `ContainerBuilder`, then call `.build()`. The `ContainerBuilder` takes care of instantiating your dependencies in the correct order, ensuring that dependencies are created before their dependents. If all goes well, you'll get a `Container` instance returned from `.build()`.

To add a provider, call the appropriate method on the `ContainerBuilder`.

There are 3 provider types you can use:

1. Class providers: call `.registerClass(SomeClass)`. Class providers use constructor injection and need to have a static `deps` array that declares their dependencies. There's type safety to ensure that the `deps` array matches your constructor signature.

2. Factory providers: call `.registerFactory(someFactory)`. Factories are useful for making third party libraries injectable, and they can be sync or async. Use the `defineFactory` helper function to define your factory so you get type safety around injected deps.

3. Value providers: call `.registerValue(token, value)`. This is useful for making static data injectable. Use `createToken` to create the token.

Note: Each token can only be registered once. Attempting to register the same token twice will throw an error. Use `overrideValue()`, `overrideClass()`, or `overrideFactory()` if you need to replace a registration (e.g., for testing).

### Class Providers

#### Deps Array

Class providers work by declaring their dependencies in a static `deps` array.

In the initial example, our `UserService` injects the `UserRepository`, so it must declare the `UserRepository` in its deps array. The deps array is how we tell the container what to inject without resorting to decorators.

```typescript
class UserService {
  static readonly deps = [UserRepository] as const;

  constructor(private readonly userRepo: UserRepository) {}

  public async getUser(id: string) {
    return this.userRepo.findById(id);
  }
}
```

#### Lifecycle Hooks

When creating singleton services, it's common to need to do some async setup and teardown, such as connecting/disconnecting from a database or priming a cache.
You can do this by declaring `onInit` and `onDestroy` methods in your service, both of which can be sync or async. You can optionally implement the `OnInit` and/or `OnDestroy` interfaces, but they aren't required.

```typescript
import { OnInit, OnDestroy } from '@brianmcd/di';

class UserService implements OnInit {
  static readonly deps = [UserRepository] as const;

  constructor(private readonly userRepo: UserRepository) {}

  public async onInit(): Promise<void> {
    // Do some async stuff.
  }

  public async onDestroy(): Promise<void> {
    // Do some async stuff.
  }
}
```

### Factory Providers

Factory providers let you register a function that returns the provided instance. Factory functions are injectable, so you can use other dependencies in them. You can also register an `onDestroy` hook, which can be async or sync, to do cleanup when the Container is destroyed.

Note: Unlike class providers, factories do **not** support `onInit`. If you need initialization logic, perform it in the factory function itself (which can be async).

**defineFactory**

Use the `defineFactory` helper function to define a factory. `defineFactory` gives you type safety between the factory's `deps` array and the factory function.

```typescript
import { Database } from 'some-third-party-lib';
import { createToken, defineFactory } from '@brianmcd/di';

export const DATABASE = createToken<Database>('DATABASE');

export const dbFactory = defineFactory({
  provide: DATABASE,
  deps: [DB_OPTIONS] as const, // Assuming this was provided in your `ContainerBuilder`.
  factory: (options) => new Database(options.connectionString),
  // onDestroy.deps can reference the factory's own token (DATABASE) to receive
  // the created instance for cleanup.
  onDestroy: {
    deps: [DATABASE] as const,
    handler: async (db) => await db.destroy(),
  },
});
```

### Value Providers

Value providers register static data. Note that values are considered "externally managed" - lifecycle hooks (`onInit`/`onDestroy`) are never called on values, even if the value object happens to have those methods.

```typescript
const CONFIG = createToken<{ value: string }>('CONFIG');

const container = await new ContainerBuilder().registerValue(CONFIG, { value: 'test' }).build();

expect(container.get(CONFIG)).toEqual({ value: 'test' });
```

## Scoped Containers

The default behavior of the Container is to create singleton instances whose lifetime is the lifetime of the application. Sometimes, however, you have a set of providers that need to create new instances within some other scope, such as per-request. You can achieve that with Scoped Containers and defining the scope when you register your provider.

### Provider Scope

There are 2 scope options when registering a provider:

1. Singleton (default): The provider is instantiated once when `.build()` is called on the `ContainerBuilder`.
2. Scoped: The provider can only be created in a ScopedContainer. This is how you implement request-scoping.

**Important:** Singleton providers cannot depend on Scoped providers. This constraint is validated at build time - you'll get an error if a singleton tries to inject a scoped dependency.

### Using a Scoped Container

It goes like this:

1. Register your providers in a `ContainerBuilder`. Use `{ scope: Scope.Scoped }` for any providers that should be scoped to a ScopedContainer.
2. Call `.build` to get your `Container`.
3. In your application, call `container.createScope()` to get a new `ScopedContainer`. This is like a clean slate for any scoped dependencies. In express, you'd probably do this in a middleware and attach the `ScopedContainer` to the request. In GraphQL, you'd probably do this in the context creation function and attach the `ScopedContainer` to the context.

`ScopedContainer`s provide access to both singletons and scoped providers, but through separate methods to prevent accidental misuse:

- `scope.get(token)` - Retrieves **only singletons** from the parent container. Throws if you try to access a scoped provider.
- `scope.getScoped(token)` - Retrieves **only scoped instances**. Creates and caches the instance on first access. Throws if you try to access a singleton.

This separation ensures you always know what kind of dependency you're getting, preventing accidental data leaks from using a singleton when you expected a request-scoped instance.

Within a `ScopedContainer`, Scoped dependencies are created **once** and then cached. Each `ScopedContainer` you create gets its own cache.

When you're done with your `ScopedContainer`, be sure to call `.destroy()` on it to run any `onDestroy` hooks.

## Creating Reusable Packages

A common pattern is to break applications up into separate packages or libraries. `@brianmcd/di` supports this use case well via `ContainerBuilder`'s `merge` method.

### Recipe

In your library, register your providers with a `ContainerBuilder`, but don't call `.build()` on it. Export the `ContainerBuilder` instance.

In your consuming application, simply call `.merge(yourLibraryContainerBuilder)`. This will merge all of the library's providers into the application's `ContainerBuilder`.

Two important caveats:
1. A `ContainerBuilder` forms a single namespace, so you can't provide the same token in your library and in your application.
2. BUT, you can merge a single `ContainerBuilder` in multiple times without issue, which you might want to do if you have some reusable code used in multiple libraries that export `ContainerBuilder`s, and then those `ContainerBuilder`s are in turn merged into your application's `ContainerBuilder`.

### Example

```typescript
// In your library package (e.g., @myorg/auth)
import { ContainerBuilder } from '@brianmcd/di';

class AuthService {
  // ...
}

// Export the ContainerBuilder, not a built Container
export const authModule = new ContainerBuilder().registerClass(AuthService);

// In your application
import { ContainerBuilder } from '@brianmcd/di';
import { authModule } from '@myorg/auth';

const container = await new ContainerBuilder()
  .merge(authModule)
  .registerClass(MyAppService)
  .build();
```

## API Reference

### ContainerBuilder

Fluent builder for constructing Containers. Call `.build()` at the end to get your initialized `Container`.

#### Methods

- `registerValue<T>(token, value): this` - Register a plain value
- `registerClass<T>(Class, options?): this` - Register a class with static `deps` property
- `registerFactory<T>(provider, options?): this` - Register a factory provider
- `merge(otherBuilder): this` - Merge registrations from another builder
- `has(token): boolean` - Check if a token has been registered
- `build(options?: { init?: boolean }): Promise<Container>` - Build the container. By default, also calls `init()` on the container. Set `{ init: false }` to skip automatic initialization if you need manual control over when `onInit` hooks run (useful for testing or staged startup).

For testing, you can explicitly override tokens that have already been registered:

- `overrideValue<T>(token, value): this` - Override an existing singleton registration with a value. Throws if the original provider is scoped.
- `overrideClass<T>(token, Class): this` - Override an existing registration with a class. Preserves the original scope.
- `overrideFactory<T>(provider): this` - Override an existing registration with a factory. Preserves the original scope.

You don't need to use the same provider type in your override that was used when the token was first registered. It's common to override a class with a mocked value using `overrideValue`, for example.

### Container

The core DI container that holds service instances.

#### Methods

- `get<T>(token: Token<T>): T` - Retrieve a service by its token.
- `init(): Promise<void>` - Initialize all services (calls `onInit` on all services, ensuring dependencies are initialized before dependents).
- `destroy(): Promise<void>` - Destroy all services (calls `onDestroy` in reverse order, ensuring dependencies are destroyed after dependents).
- `createScope(): ScopedContainer` - Create a new scoped container for scoped dependencies.

### ScopedContainer

Container for scoped instances, created via `container.createScope()`.

#### Methods

- `get<T>(token: Token<T>): T` - Retrieve a singleton instance from the parent container. Throws an error if the token is a scoped provider (use `getScoped()` instead).
- `getScoped<T>(token: Token<T>): Promise<T>` - Retrieve or create a scoped instance. Returns a Promise because scoped providers may have async factories that need to be resolved on-demand. The instance is cached for the lifetime of the `ScopedContainer`. Throws an error if the token is a singleton (use `get()` instead).
- `destroy(): Promise<void>` - Run `onDestroy` on all `Scope.Scoped` instances that were created.

### Helper Functions

- `createToken<T>(name): TypedToken<T>` - Create a typed token for non-class dependencies.
- `defineFactory(config): FactoryProvider` - Define a factory with type safety.

### Interfaces

- `OnInit` - Implement `onInit(): Promise<void> | void` for initialization logic in class providers.
- `OnDestroy` - Implement `onDestroy(): Promise<void> | void` for cleanup logic in class providers.

## Testing

Use `merge()` and override methods to easily mock dependencies:

```typescript
// Create a module with your production services
const createAppModule = () =>
  new ContainerBuilder()
    .registerValue(CONFIG, productionConfig)
    .registerFactory(databaseFactory)
    .registerClass(UserService);

// In tests, merge and override specific dependencies
const testContainer = await new ContainerBuilder()
  .merge(createAppModule())
  .overrideValue(CONFIG, testConfig)
  .overrideValue(DATABASE, mockDatabase)
  .build();

// UserService now uses mockDatabase
const userService = testContainer.get(UserService);
```

### Overriding Scoped Providers

For scoped providers, use `overrideClass()` or `overrideFactory()`. These methods automatically preserve the original scope, so the provider remains accessible via `getScoped()`:

```typescript
// Override a scoped class with a mock factory
const testContainer = await new ContainerBuilder()
  .merge(createAppModule())
  .overrideFactory({
    provide: RequestScopedService,
    deps: [] as const,
    factory: () => mockRequestScopedService,
  })
  .build();

const scope = testContainer.createScope();
const service = await scope.getScoped(RequestScopedService); // Returns mock
```

Note: `overrideValue()` cannot be used with scoped providers because values are always singletons. Use `overrideFactory()` instead.

## Type Safety

The goal of this library is to provide type safety without limiting or complicating the library.

To accomplish this, there are some tradeoffs to be aware of:

1. The deps array is typechecked with the constructor parameters, but the compiler error will be thrown by the `ContainerBuilder` when you register the provider, not in the class. I explored ways to move the error to the class, but all of them required clumsy syntax.
2. There is **no** _compile-time_ enforcement that the dependencies you declare in your deps array are actually provided in the `ContainerBuilder`, but you **will** get a _runtime_ error in this case as soon as you call `.build()`.

So in general, there **is** compile-time type safety around dependency usage, but there **is not** compile-time type safety around dependency existence. Since you will get runtime errors as soon as you call `.build()`, this isn't a big limitation in practice, and it allows us to keep the library much simpler and more flexible.

## Acknowledgements

The API for this library is inspired by the dependency injection in [Nest.js](https://nestjs.com/), Angular/AngularJS, and [typed-inject](https://github.com/nicojs/typed-inject).

## License

MIT
