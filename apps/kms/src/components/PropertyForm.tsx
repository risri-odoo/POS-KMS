import { useState, type FormEvent } from 'react';
import { Button, Card, Field, Input } from '@stayx/ui';
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
      <Card padding="lg" className="w-full max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold text-telivity-navy">StayX Kitchen</h1>
          <Field label="Property ID" error={error ?? undefined}>
            {(id) => (
              <Input
                id={id}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
                invalid={Boolean(error)}
                className="min-h-12 font-mono text-base!"
              />
            )}
          </Field>
          <Button type="submit" size="touch" highContrast>
            Open board
          </Button>
        </form>
      </Card>
    </main>
  );
}
