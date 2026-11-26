/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Used when the URL has no ?propertyId=. */
  readonly VITE_DEFAULT_PROPERTY_ID?: string;
  /** Staff login: the OIDC issuer, e.g. http://localhost:8080/realms/haip. Unset: login off. */
  readonly VITE_OIDC_AUTHORITY?: string;
  /** Defaults to stayx-pos-web. */
  readonly VITE_OIDC_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
