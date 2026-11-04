import { useState, type FormEvent } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import {
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  PageHeader,
  SkeletonTable,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@stayx/ui';
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
    <>
      <PageHeader title="Menu" icon={UtensilsCrossed} className="mb-4!" />
      <div className="flex flex-col gap-4">
        <AddItemForm propertyId={propertyId} onCreated={(item) => onMenuChange((m) => [...m, item])} notify={notify} />

        <section aria-label="Menu items">
          <h2 className="mb-2 text-sm font-semibold text-telivity-navy">Menu items</h2>
          {menu === null ? (
            <SkeletonTable cols={5} />
          ) : (
            <Table tableClassName="min-w-[40rem]">
              <TableHead>
                <TableHeader>Name</TableHeader>
                <TableHeader>Category</TableHeader>
                <TableHeader>Price</TableHeader>
                <TableHeader>Available</TableHeader>
                <TableHeader />
              </TableHead>
              <tbody>
                {menu.length === 0 && <TableEmpty colSpan={5}>No menu items yet.</TableEmpty>}
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
            </Table>
          )}
          <p className="mt-2 text-xs text-gray-500">
            Changing a price only affects new orders. Existing orders keep the prices they were placed with.
          </p>
        </section>
      </div>
    </>
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

  return (
    <TableRow className={`align-top ${item.isAvailable ? '' : 'bg-gray-50 [&>td]:text-gray-500'}`}>
      {editing ? (
        <>
          <TableCell>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} aria-label="Name" className="min-h-11" />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </TableCell>
          <TableCell>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} aria-label="Category" className="min-h-11" />
          </TableCell>
          <TableCell>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Price" className="min-h-11 tabular-nums" />
          </TableCell>
        </>
      ) : (
        <>
          <TableCell strong>{item.name}</TableCell>
          <TableCell>{item.category || <span className="text-telivity-mid-grey">—</span>}</TableCell>
          <TableCell className="tabular-nums">{formatPrice(item.price, item.currencyCode)}</TableCell>
        </>
      )}
      <TableCell>
        <button
          type="button"
          role="switch"
          aria-checked={item.isAvailable}
          aria-label={`${item.name} available`}
          onClick={onToggle}
          className={`min-h-11 min-w-20 rounded-full px-3 text-sm font-semibold transition-colors ${
            item.isAvailable ? 'bg-telivity-dark-teal text-white' : 'bg-gray-200 text-telivity-slate'
          }`}
        >
          {item.isAvailable ? 'On' : 'Off'}
        </button>
      </TableCell>
      <TableCell align="right">
        {editing ? (
          <div className="flex justify-end gap-2">
            <Button disabled={saving} onClick={() => void save()} className="min-h-11">
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => setEditing(false)} className="min-h-11">
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={startEdit} className="min-h-11">
            Edit
          </Button>
        )}
      </TableCell>
    </TableRow>
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
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-label="Add menu item">
        <CardTitle className="mb-0!">Add item</CardTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Name *" error={errors.name} value={form.name} onChange={set('name')} maxLength={255} />
          <TextField label="Category" error={errors.category} value={form.category} onChange={set('category')} maxLength={100} />
          <TextField label="Price *" error={errors.price} value={form.price} onChange={set('price')} inputMode="decimal" placeholder="12.50" />
          <TextField label="Currency" error={errors.currencyCode} value={form.currencyCode} onChange={set('currencyCode')} maxLength={3} />
          <TextField label="Sort order" error={errors.sortOrder} value={form.sortOrder} onChange={set('sortOrder')} inputMode="numeric" placeholder="0" />
          <TextField label="Description" error={errors.description} value={form.description} onChange={set('description')} />
        </div>
        {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        <Button type="submit" disabled={saving} className="min-h-11 self-start">
          {saving ? 'Adding…' : 'Add item'}
        </Button>
      </form>
    </Card>
  );
}

function TextField({
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
    <Field label={label} error={error}>
      {(id) => <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={Boolean(error)} className="min-h-11" {...rest} />}
    </Field>
  );
}
