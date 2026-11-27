import type { Plugin } from 'vite';

/**
 * Strict Content-Security-Policy for the POS and KMS pages (INTEGRATION_DESIGN.md §8.6,
 * Step H). Scripts only from the page's own origin: no inline or third-party scripts,
 * no eval. The page may talk only to the POS API (HTTP and its Socket.IO WebSocket) and
 * the identity provider. It limits what an injected script could do with the tokens the
 * screens keep (KMS keeps them in localStorage).
 */
export interface CspOptions {
  /** The POS API base, e.g. http://localhost:4000/api/v1 (only its origin is used). */
  apiUrl: string;
  /** The OIDC issuer, e.g. http://localhost:8080/realms/haip. Unset when login is off. */
  oidcAuthority?: string;
}

const origin = (url: string) => new URL(url).origin;
const wsOrigin = (url: string) => {
  const u = new URL(url);
  return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
};

export function buildCsp({ apiUrl, oidcAuthority }: CspOptions): string {
  const api = origin(apiUrl);
  const idp = oidcAuthority ? origin(oidcAuthority) : null;
  const directives: [string, string[]][] = [
    ['default-src', ["'none'"]],
    ['script-src', ["'self'"]],
    // Tailwind's built stylesheet only. React's style props go through the DOM (CSSOM),
    // which CSP doesn't block, so no 'unsafe-inline'.
    ['style-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['img-src', ["'self'", 'data:']],
    // API calls, the Socket.IO WebSocket (and its polling fallback), the token endpoint.
    ['connect-src', ["'self'", api, wsOrigin(apiUrl), ...(idp ? [idp] : [])]],
    // oidc-client-ts falls back to a hidden iframe to renew if there's no refresh token.
    ['frame-src', idp ? [idp] : ["'none'"]],
    ['form-action', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`).join('; ');
}

/**
 * Directives that only work as an HTTP header, not in a <meta> tag. Whoever serves the
 * built pages should send these (with the policy itself) as Content-Security-Policy.
 */
export const HEADER_ONLY_DIRECTIVES = "frame-ancestors 'none'";

/** A <script> with a body (no src) would be blocked by script-src 'self'. */
export function findInlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs, body]) => !/\bsrc\s*=/.test(attrs ?? '') && (body ?? '').trim() !== '')
    .map(([tag]) => tag.slice(0, 80));
}

/**
 * Vite plugin: adds the policy as a <meta http-equiv> tag to the BUILT page only. The dev
 * server needs inline scripts (React fast refresh), so it is left alone. Fails the build if
 * the page has an inline script, which the policy would block.
 * @param defaults used when VITE_API_URL / VITE_OIDC_AUTHORITY are not set for the build
 */
export function cspPlugin(defaults: { apiUrl: string }): Plugin {
  let options: CspOptions = { apiUrl: defaults.apiUrl };
  return {
    name: 'stayx-csp',
    apply: 'build',
    configResolved(config) {
      const env = config.env as Record<string, string | undefined>;
      options = {
        apiUrl: env['VITE_API_URL']?.trim() || defaults.apiUrl,
        oidcAuthority: env['VITE_OIDC_AUTHORITY']?.trim() || undefined,
      };
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = findInlineScripts(html);
        if (inline.length > 0) throw new Error(`stayx-csp: inline script(s) would be blocked by the CSP: ${inline.join(' | ')}`);
        const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(options)}" />`;
        const charset = /<meta charset="[^"]*"\s*\/?>/i;
        // The policy must come before anything it governs; never ship a page without it.
        if (!charset.test(html)) throw new Error('stayx-csp: no <meta charset> to put the policy after');
        return html.replace(charset, (m) => `${m}\n    ${meta}`);
      },
    },
  };
}
