import { useState, type FormEvent } from 'react';
import { isUuid } from '../config.js';

/** Shown when ?propertyId= is missing or not a UUID. Reloads with it set. */
export function PropertyForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const propertyId = value.trim();
    if (!isUuid(propertyId)) {
      setError('That is not a valid property ID (UUID).');
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('propertyId', propertyId);
    window.location.assign(url.toString());
  };

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="flex w-full max-w-lg flex-col gap-4 rounded-xl bg-neutral-900 p-6">
        <h1 className="text-3xl font-bold">POS</h1>
        <label htmlFor="propertyId" className="text-lg text-neutral-300">
          Property ID
        </label>
        <input
          id="propertyId"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 rounded-lg border border-neutral-700 bg-neutral-950 px-3 font-mono text-lg"
        />
        {error && <p className="text-lg text-red-400">{error}</p>}
        <button type="submit" className="min-h-14 rounded-lg bg-emerald-600 text-xl font-bold text-white">
          Open POS
        </button>
      </form>
    </main>
  );
}
