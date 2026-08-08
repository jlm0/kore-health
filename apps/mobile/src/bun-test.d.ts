// Minimal typings for `bun:test` so the bun-runner tests typecheck without
// adding a @types/bun dependency. Only the surface the tests use is declared.
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => unknown | Promise<unknown>): void;
  export const test: typeof it;
  export function beforeEach(fn: () => unknown): void;
  export function afterEach(fn: () => unknown): void;

  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toHaveLength(length: number): void;
    toContain(item: unknown): void;
    toThrow(expected?: unknown): void;
    not: Matchers;
  }
  export function expect(actual?: unknown): Matchers;

  export const mock: {
    (implementation?: (...args: never[]) => unknown): (...args: never[]) => unknown;
    module(specifier: string, factory: () => unknown): void;
  };
}
