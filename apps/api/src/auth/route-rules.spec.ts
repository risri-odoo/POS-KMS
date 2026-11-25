import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { IS_PUBLIC } from './public.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * INTEGRATION_DESIGN.md §8.4, written out. A new route fails this test until it is
 * added here with its roles, so no route can go out without a decision.
 */
const EXPECTED: Record<string, string> = {
  'GET /': 'public',
  'GET /menu-items': 'pos_staff, pos_manager',
  'POST /menu-items': 'pos_manager',
  'PATCH /menu-items/:id': 'pos_manager',
  'GET /stays/lookup': 'pos_staff, pos_manager',
  'POST /orders': 'pos_staff, pos_manager',
  'GET /orders': 'pos_staff, pos_kitchen, pos_manager',
  'GET /orders/:id': 'pos_staff, pos_kitchen, pos_manager',
  'PATCH /orders/:id/status': 'pos_kitchen, pos_manager',
  'GET /outbox': 'pos_manager',
  'POST /outbox/:id/retry': 'pos_manager',
  'POST /outbox/:id/resolve': 'pos_manager',
};

const SRC = fileURLToPath(new URL('..', import.meta.url));

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

const joinPath = (...parts: (string | undefined)[]) =>
  '/' + parts.flatMap((p) => (p ?? '').split('/')).filter(Boolean).join('/');

/** Every route in every controller under src/, with its rule as the guards read it. */
async function actualRules(): Promise<Record<string, string>> {
  const rules: Record<string, string> = {};
  for (const file of controllerFiles(SRC)) {
    const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(exports)) {
      if (typeof value !== 'function') continue;
      const controller = value as new (...args: never[]) => unknown;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      if (base === undefined) continue; // not a controller class
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue; // not a route
        const route = `${RequestMethod[method]} ${joinPath(base, Reflect.getMetadata(PATH_METADATA, handler) as string)}`;
        const isPublic = Reflect.getMetadata(IS_PUBLIC, handler) ?? Reflect.getMetadata(IS_PUBLIC, controller);
        const roles = (Reflect.getMetadata(ROLES_KEY, handler) ?? Reflect.getMetadata(ROLES_KEY, controller)) as string[] | undefined;
        rules[route] = isPublic ? 'public' : roles ? [...roles].sort().join(', ') : 'NO RULE';
      }
    }
  }
  return rules;
}

describe('route rules (INTEGRATION_DESIGN.md §8.4)', () => {
  it('every route has exactly the roles in the design table, and none is left without a rule', async () => {
    const sorted = (rule: string) => (rule === 'public' ? rule : rule.split(', ').sort().join(', '));
    expect(await actualRules()).toEqual(Object.fromEntries(Object.entries(EXPECTED).map(([route, rule]) => [route, sorted(rule)])));
  });
});
