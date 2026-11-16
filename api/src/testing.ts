import type { Type } from '@nestjs/common';
import { AppModule } from './app.module';

// What the tests of the whole API share. Only tests load this file: the build leaves it out
// (tsconfig.build.json). Loading it loads AppModule, and so @nestjs/config: a spec that uses it
// puts a stand-in for that one first (see app.module.spec.ts).

/** What a module class declares under `key`: its imports, its controllers or its providers. */
export const declared = (module: unknown, key: string): unknown[] => (Reflect.getMetadata(key, module as object) as unknown[] | undefined) ?? [];

/** AppModule and every module it imports, and the ones those import, each once. */
export function apiModules(): unknown[] {
  const found: unknown[] = [];
  const visit = (entry: unknown): void => {
    // An import is a module class, or a dynamic module that names its class: ThrottlerModule.forRootAsync(...).
    const module = typeof entry === 'function' ? entry : (entry as { module?: unknown }).module;
    if (!module || found.includes(module)) return;
    found.push(module);
    declared(module, 'imports').forEach(visit);
  };
  visit(AppModule);
  return found;
}

/** Every controller the API mounts: the ones of the feature modules AppModule imports. */
export function apiControllers(): Type[] {
  return apiModules().flatMap((module) => declared(module, 'controllers')) as Type[];
}
