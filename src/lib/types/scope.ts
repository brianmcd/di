export const Scope = {
  Singleton: 'singleton',
  Scoped: 'scoped',
} as const;

export type Scope = (typeof Scope)[keyof typeof Scope];
