import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, ClipboardList, Palette, Plus, UtensilsCrossed } from 'lucide-react';
import {
  AppShell,
  Badge,
  Button,
  Card,
  CardTitle,
  ConfirmModal,
  EmptyState,
  Field,
  Input,
  OrderStatusBadge,
  PageHeader,
  Select,
  SkeletonCard,
  SkeletonTable,
  Spinner,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  ToastStack,
  ToastView,
  type NavSection,
  type OrderStatus,
} from '../src/index.js';
import './preview.css';

const STATUSES: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'];

const SWATCHES = [
  ['teal', 'bg-telivity-teal'],
  ['dark-teal', 'bg-telivity-dark-teal'],
  ['light-teal', 'bg-telivity-light-teal'],
  ['orange', 'bg-telivity-orange'],
  ['yellow', 'bg-telivity-yellow'],
  ['deep-blue', 'bg-telivity-deep-blue'],
  ['purple', 'bg-telivity-purple'],
  ['navy', 'bg-telivity-navy'],
  ['slate', 'bg-telivity-slate'],
  ['mid-grey', 'bg-telivity-mid-grey'],
] as const;

const NAV: NavSection[] = [
  {
    items: [
      { href: '#orders', label: 'Orders', icon: ClipboardList },
      { href: '#menu', label: 'Menu', icon: UtensilsCrossed },
      { href: '#preview', label: 'UI preview', icon: Palette, active: true },
    ],
  },
  {
    title: 'Back office',
    items: [{ href: '#outbox', label: 'Outbox/Errors', icon: AlertTriangle, disabled: true, hint: 'Soon' }],
  },
];

function Preview() {
  const params = new URLSearchParams(location.search);
  const [modalOpen, setModalOpen] = useState(params.has('modal'));
  const [toastOpen, setToastOpen] = useState(true);

  return (
    <AppShell
      brand="StayX POS"
      tagline="Room service"
      nav={NAV}
      connection="connected"
      headerStart={<span className="hidden text-sm text-telivity-mid-grey md:inline">Component preview</span>}
      footer="v0.1.0"
    >
      <PageHeader
        title="UI preview"
        icon={Palette}
        actions={
          <>
            <Button variant="secondary">Secondary</Button>
            <Button icon={Plus} onClick={() => setModalOpen(true)}>
              Open modal
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Colours</CardTitle>
          <div className="grid grid-cols-5 gap-3">
            {SWATCHES.map(([name, swatch]) => (
              <div key={name}>
                <div className={`h-10 rounded-lg ${swatch}`} />
                <p className="mt-1 text-xs text-telivity-slate">{name}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Order statuses</CardTitle>
          <p className="mb-2 text-xs font-medium text-telivity-slate">POS (matches HAIP)</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <OrderStatusBadge key={status} status={status} />
            ))}
          </div>
          <p className="mb-2 text-xs font-medium text-telivity-slate">KMS (high contrast, large)</p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <OrderStatusBadge key={status} status={status} size="lg" highContrast />
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Buttons</CardTitle>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="sm">Small</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="touch" highContrast>
              Start preparing
            </Button>
            <Button size="touch" variant="secondary">
              Cancel
            </Button>
          </div>
        </Card>

        <Card>
          <CardTitle>Form controls</CardTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Room number">{(id) => <Input id={id} placeholder="e.g. 210" />}</Field>
            <Field label="Category">
              {(id) => (
                <Select id={id} defaultValue="mains">
                  <option value="mains">Mains</option>
                  <option value="drinks">Drinks</option>
                </Select>
              )}
            </Field>
            <Field label="Price" error="Enter a price, for example 12.50">
              {(id) => <Input id={id} invalid defaultValue="abc" />}
            </Field>
            <Field label="Notes" hint="Shown to the kitchen">
              {(id) => <Textarea id={id} rows={1} />}
            </Field>
          </div>
        </Card>

        <div className="lg:col-span-2">
          <Table>
            <TableHead>
              <TableHeader>Order</TableHeader>
              <TableHeader>Room</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader align="right">Total</TableHeader>
            </TableHead>
            <tbody>
              {STATUSES.slice(0, 4).map((status, index) => (
                <TableRow key={status}>
                  <TableCell strong>RS-261105-{index + 1}A7K</TableCell>
                  <TableCell>{210 + index}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={status} />
                  </TableCell>
                  <TableCell align="right">$22.40</TableCell>
                </TableRow>
              ))}
              <TableEmpty colSpan={4}>Empty table row</TableEmpty>
            </tbody>
          </Table>
        </div>

        <Card>
          <CardTitle>Empty and loading</CardTitle>
          <EmptyState icon={ClipboardList}>No orders yet</EmptyState>
          <div className="flex items-center gap-2 text-sm text-telivity-slate">
            <Spinner /> Loading
          </div>
        </Card>

        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonTable rows={2} cols={3} />
        </div>

        <Card>
          <CardTitle>Other badges</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge tone="purple">Purple</Badge>
            <Badge tone="deep-blue">Info</Badge>
            <Badge tone="orange">Warning</Badge>
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={modalOpen}
        title="Cancel order?"
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        danger
        touch
        onConfirm={() => setModalOpen(false)}
        onCancel={() => setModalOpen(false)}
      >
        Cancel order RS-261105-1A7K for room 210?
      </ConfirmModal>

      {toastOpen && (
        <ToastStack>
          <ToastView type="success" message="Order RS-261105-1A7K placed for room 210: $22.40" sticky onDismiss={() => setToastOpen(false)} />
        </ToastStack>
      )}
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
