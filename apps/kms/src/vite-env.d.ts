/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Used when the URL has no ?propertyId=. */
  readonly VITE_DEFAULT_PROPERTY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
