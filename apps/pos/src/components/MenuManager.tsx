import { useState, type FormEvent } from 'react';
import { createMenuItem, messageOf, updateMenuItem } from '../api.js';
import {
  formatPrice,
  normalizePrice,
  validateMenuItemForm,
  validatePrice,
  type MenuItemForm,
  type MenuItemFormErrors,
} from '../money.js';
import type { MenuItem, UpdateMenuItemBody } from '../types.js';

interface Props {
  propertyId: string;
  menu: MenuItem[] | null;
  /** Apply a change to the shared menu (also keeps the cart in sync). */
  onMenuChange: (update: (menu: MenuItem[]) => MenuItem[]) => void;
  notify: (kind: 'success' | 'error', text: string) => void;
}

const replace = (item: MenuItem) => (menu: MenuItem[]) => menu.map((m) => (m.id === item.id ? item : m));

export function MenuManager({ propertyId, menu, onMenuChange, notify }: Props) {
  // Optimistic availability toggle: flip locally, PATCH, roll back on failure.
  const toggleAvailable = async (item: MenuItem) => {
    const next = !item.isAvailable;
    onMenuChange((m) => m.map((x) => (x.id === item.id ? { ...x, isAvailable: next } : x)));
    try {
      onMenuChange(replace(await updateMenuItem(propertyId, item.id, { isAvailable: next })));
    } catch (error) {
      onMenuChange((m) => m.map((x) => (x.id === item.id ? { ...x, isAvailable: item.isAvailable } : x)));
      notify('error', `Could not update "${item.name}": ${messageOf(error)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <AddItemForm propertyId={propertyId} onCreated={(item) => onMenuChange((m) => [...m, item])} notify={notify} />

      <section className="rounded-xl bg-neutral-900 p-3" aria-label="Menu items">
        <h2 className="mb-2 text-2xl font-bold">Menu items</h2>
        {menu === null ? (
          <p className="text-lg text-neutral-400">Loading…</p>
        ) : menu.length === 0 ? (
          <p className="text-lg text-neutral-400">No menu items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-lg">
              <thead className="text-base text-neutral-400">
                <tr>
                  <th className="p-2">Name</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Price</th>
                  <th className="p-2">Available</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {menu.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    propertyId={propertyId}
                    onToggle={() => void toggleAvailable(item)}
                    onSaved={(saved) => onMenuChange(replace(saved))}
                    notify={notify}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm text-neutral-500">
          Changing a price only affects new orders. Existing orders keep the prices they were placed with.
        </p>
      </section>
    </div>
  );
}

function MenuRow({
  item,
  propertyId,
  onToggle,
  onSaved,
  notify,
}: {
  item: MenuItem;
  propertyId: string;
  onToggle: () => void;
  onSaved: (item: MenuItem) => void;
  notify: Props['notify'];
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? '');
  const [price, setPrice] = useState(item.price);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(item.name);
    setCategory(item.category ?? '');
    setPrice(item.price);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    if (!trimmedName) return setError('Name is required');
    if (trimmedName.length > 255) return setError('Name must be 255 characters or fewer');
    if (trimmedCategory.length > 100) return setError('Category must be 100 characters or fewer');
    const priceError = validatePrice(price);
    if (priceError) return setError(priceError);

    // Send only what changed.
    const body: UpdateMenuItemBody = {};
    if (trimmedName !== item.name) body.name = trimmedName;
    if (trimmedCategory !== (item.category ?? '')) body.category = trimmedCategory || null;
    const normalized = normalizePrice(price);
    if (normalized !== item.price) body.price = normalized;
    if (Object.keys(body).length === 0) return setEditing(false);

    setSaving(true);
    setError(null);
    try {
      onSaved(await updateMenuItem(propertyId, item.id, body));
      setEditing(false);
      notify('success', `Saved "${trimmedName}".`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const input = 'min-h-12 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2';

  return (
    <tr className={`border-t border-neutral-800 align-top ${item.isAvailable ? '' : 'text-neutral-500'}`}>
      {editing ? (
        <>
          <td className="p-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} aria-label="Name" className={input} />
            {error && <p className="mt-1 text-base text-red-400">{error}</p>}
          </td>
          <td className="p-2">
            <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} aria-label="Category" className={input} />
          </td>
          <td className="p-2">
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Price" className={`${input} tabular-nums`} />
          </td>
        </>
      ) : (
        <>
          <td className="p-2 font-semibold">{item.name}</td>
          <td className="p-2">{item.category || <span className="text-neutral-600">—</span>}</td>
          <td className="p-2 tabular-nums">{formatPrice(item.price, item.currencyCode)}</td>
        </>
      )}
      <td className="p-2">
        <button
          type="button"
          role="switch"
          aria-checked={item.isAvailable}
          aria-label={`${item.name} available`}
          onClick={onToggle}
          className={`min-h-12 min-w-24 rounded-full px-3 font-bold ${item.isAvailable ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300'}`}
        >
          {item.isAvailable ? 'On' : 'Off'}
        </button>
      </td>
      <td className="p-2 text-right">
        {editing ? (
          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => void save()} className="min-h-12 rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className="min-h-12 rounded-lg bg-neutral-800 px-4 font-semibold">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={startEdit} className="min-h-12 rounded-lg bg-neutral-800 px-4 font-semibold hover:bg-neutral-700">
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}

const EMPTY_FORM: MenuItemForm = { name: '', category: '', description: '', price: '', currencyCode: 'USD', sortOrder: '' };

function AddItemForm({
  propertyId,
  onCreated,
  notify,
}: {
  propertyId: string;
  onCreated: (item: MenuItem) => void;
  notify: Props['notify'];
}) {
  const [form, setForm] = useState<MenuItemForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<MenuItemFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof MenuItemForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateMenuItemForm(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const created = await createMenuItem({
        propertyId,
        name: form.name.trim(),
        price: normalizePrice(form.price),
        currencyCode: form.currencyCode.trim().toUpperCase(),
        ...(form.category.trim() ? { category: form.category.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.sortOrder.trim() ? { sortOrder: Number(form.sortOrder.trim()) } : {}),
      });
      onCreated(created);
      setForm({ ...EMPTY_FORM, currencyCode: form.currencyCode, category: form.category });
      notify('success', `Added "${created.name}".`);
    } catch (error) {
      setServerError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-xl bg-neutral-900 p-3" aria-label="Add menu item">
      <h2 className="text-2xl font-bold">Add item</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name *" error={errors.name} value={form.name} onChange={set('name')} maxLength={255} />
        <Field label="Category" error={errors.category} value={form.category} onChange={set('category')} maxLength={100} />
        <Field label="Price *" error={errors.price} value={form.price} onChange={set('price')} inputMode="decimal" placeholder="12.50" />
        <Field label="Currency" error={errors.currencyCode} value={form.currencyCode} onChange={set('currencyCode')} maxLength={3} />
        <Field label="Sort order" error={errors.sortOrder} value={form.sortOrder} onChange={set('sortOrder')} inputMode="numeric" placeholder="0" />
        <Field label="Description" error={errors.description} value={form.description} onChange={set('description')} />
      </div>
      {serverError && <p className="text-lg text-red-400">{serverError}</p>}
      <button type="submit" disabled={saving} className="min-h-12 self-start rounded-lg bg-emerald-600 px-6 text-lg font-bold text-white disabled:opacity-50">
        {saving ? 'Adding…' : 'Add item'}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  value,
  onChange,
  ...rest
}: {
  label: string;
  error: string | undefined;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  inputMode?: 'decimal' | 'numeric';
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-lg">
      <span className="text-neutral-300">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        className={`min-h-12 rounded-lg border bg-neutral-950 px-3 ${error ? 'border-red-500' : 'border-neutral-700'}`}
        {...rest}
      />
      {error && <span className="text-base text-red-400">{error}</span>}
    </label>
  );
}
