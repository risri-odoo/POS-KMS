import { describe, expect, it } from 'vitest';
import type { IndexHtmlTransformHook, ResolvedConfig } from 'vite';
import { buildCsp, cspPlugin, findInlineScripts } from './csp.js';

const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('buildCsp', () => {
  it('allows scripts only from the page itself, and talks only to the API and the identity provider', () => {
    const d = directives(buildCsp({ apiUrl: 'https://pos.example.com/api/v1', oidcAuthority: 'https://id.example.com/realms/haip' }));
    expect(d['default-src']).toEqual(["'none'"]);
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['style-src']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'", 'https://pos.example.com', 'wss://pos.example.com', 'https://id.example.com']);
    expect(d['frame-src']).toEqual(['https://id.example.com']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
  });

  it('never allows inline or evaluated scripts', () => {
    const csp = buildCsp({ apiUrl: 'http://localhost:4000/api/v1', oidcAuthority: 'http://localhost:8080/realms/haip' });
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('uses ws: for a plain-http API, and no identity provider when login is off', () => {
    const d = directives(buildCsp({ apiUrl: 'http://localhost:4000/api/v1' }));
    expect(d['connect-src']).toEqual(["'self'", 'http://localhost:4000', 'ws://localhost:4000']);
    expect(d['frame-src']).toEqual(["'none'"]);
  });
});

describe('findInlineScripts', () => {
  it('finds scripts with a body and ignores scripts loaded from a file', () => {
    expect(findInlineScripts('<script type="module" crossorigin src="/assets/index-x.js"></script>')).toEqual([]);
    expect(findInlineScripts('<script type="module">import "x"</script>')).toHaveLength(1);
    expect(findInlineScripts('<script>\n  window.a = 1\n</script><script src="/b.js"></script>')).toHaveLength(1);
  });
});

describe('cspPlugin', () => {
  const page = '<!doctype html><html><head><meta charset="UTF-8" /><title>x</title></head><body><script type="module" crossorigin src="/assets/index.js"></script></body></html>';
  function run(html: string, env: Record<string, string> = {}) {
    const plugin = cspPlugin({ apiUrl: 'http://localhost:4000/api/v1' });
    (plugin.configResolved as (c: ResolvedConfig) => void)({ env } as unknown as ResolvedConfig);
    const hook = plugin.transformIndexHtml as { handler: IndexHtmlTransformHook };
    return hook.handler.call({} as never, html, {} as never) as string;
  }

  it('runs on builds only (the dev server needs inline scripts for fast refresh)', () => {
    expect(cspPlugin({ apiUrl: 'http://localhost:4000/api/v1' }).apply).toBe('build');
  });

  it('puts the policy right after <meta charset>, built from the build’s settings', () => {
    const html = run(page, { VITE_API_URL: 'https://pos.example.com/api/v1', VITE_OIDC_AUTHORITY: 'https://id.example.com/realms/haip' });
    expect(html).toMatch(/<meta charset="UTF-8" \/>\n\s+<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
    expect(html).toContain('connect-src \'self\' https://pos.example.com wss://pos.example.com https://id.example.com');
  });

  it('fails the build if the page has an inline script the policy would block', () => {
    expect(() => run(page.replace('</body>', '<script>alert(1)</script></body>'))).toThrow('inline script');
  });

  it('fails the build rather than ship a page without the policy', () => {
    expect(() => run(page.replace('<meta charset="UTF-8" />', ''))).toThrow('no <meta charset>');
  });
});
