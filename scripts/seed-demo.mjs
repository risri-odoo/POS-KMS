#!/usr/bin/env node
// Adds a demo room-service menu through the running API (POST /menu-items).
// Idempotent: items whose name already exists for the property are skipped.
// Usage:  pnpm seed:demo   (needs `pnpm dev:all` or `pnpm dev` running)
// Env:    SEED_API_URL (default http://localhost:4000/api/v1)
//         SEED_PROPERTY_ID (default: the demo property)

const API = (process.env.SEED_API_URL || 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const PROPERTY_ID = process.env.SEED_PROPERTY_ID || 'a0000001-0000-4000-a000-000000000001';

const MENU = [
  { category: 'Mains', name: 'Club Sandwich', description: 'Turkey, bacon, lettuce, tomato, fries', price: '18.50' },
  { category: 'Mains', name: 'Classic Cheeseburger', description: 'Aged cheddar, pickles, brioche bun, fries', price: '22.00' },
  { category: 'Mains', name: 'Caesar Salad', description: 'Romaine, parmesan, croutons; add chicken +6', price: '16.00' },
  { category: 'Mains', name: 'Margherita Pizza', description: 'Tomato, mozzarella, basil', price: '19.00' },
  { category: 'Mains', name: 'Grilled Salmon', description: 'Seasonal vegetables, lemon butter', price: '29.00' },
  { category: 'Mains', name: 'Penne Arrabbiata', description: 'Spicy tomato sauce, vegan', price: '17.50' },
  { category: 'Drinks', name: 'Fresh Orange Juice', description: '300 ml', price: '7.00' },
  { category: 'Drinks', name: 'Sparkling Water', description: '750 ml bottle', price: '6.00' },
  { category: 'Drinks', name: 'Cappuccino', description: null, price: '5.50' },
  { category: 'Drinks', name: 'Glass of House Red', description: '175 ml', price: '12.00' },
  { category: 'Desserts', name: 'Chocolate Lava Cake', description: 'Vanilla ice cream', price: '11.00' },
  { category: 'Desserts', name: 'New York Cheesecake', description: 'Berry compote', price: '10.00' },
];

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(json?.message) ? json.message.join('; ') : json?.message || res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json;
}

let existing;
try {
  existing = await api('GET', `/menu-items?propertyId=${PROPERTY_ID}`);
} catch (error) {
  console.error(`✖ Could not reach the API at ${API}.`);
  console.error('  Start it first with `pnpm dev:all` (or `pnpm dev`) and wait for "Nest application successfully started".');
  console.error(`  (${error.cause?.code ?? error.message})`);
  process.exit(1);
}

const have = new Set(existing.map((m) => m.name.trim().toLowerCase()));
let added = 0;
for (const [i, item] of MENU.entries()) {
  if (have.has(item.name.toLowerCase())) continue;
  await api('POST', '/menu-items', {
    propertyId: PROPERTY_ID,
    category: item.category,
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    price: item.price,
    currencyCode: 'USD',
    sortOrder: i,
  });
  added++;
}

console.log(
  `✔ Demo menu for property ${PROPERTY_ID}: added ${added}, skipped ${MENU.length - added} already present.`,
);
