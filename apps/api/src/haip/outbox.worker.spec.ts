import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { OutboxWorker } from './outbox.worker.js';
import type { HaipQueue } from './haip-queue.service.js';
import type { HaipConfig } from './haip.config.js';
import type { OutboxProcessor } from './outbox.processor.js';
import type { Db } from '../database/database.module.js';

/** Fake db for the sweep query: records the WHERE and returns `due`. */
function fakeDb(due: { id: string }[]) {
  const calls: { where?: SQL } = {};
  const db = {
    select: () => ({
      from: () => ({
        where: (where: SQL) => {
          calls.where = where;
          return { orderBy: () => ({ limit: () => Promise.resolve(due) }) };
        },
      }),
    }),
  };
  return { db: db as unknown as Db, calls };
}

describe('OutboxWorker.sweep', () => {
  let enqueue: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  const make = (due: { id: string }[]) => {
    const { db, calls } = fakeDb(due);
    const worker = new OutboxWorker(db, {} as HaipConfig, { enqueue } as unknown as HaipQueue, {} as OutboxProcessor);
    return { worker, calls };
  };

  beforeEach(() => {
    enqueue = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('queues every due row it gets back', async () => {
    const { worker } = make([{ id: 'a' }, { id: 'b' }]);
    await expect(worker.sweep()).resolves.toBe(2);
    expect(enqueue.mock.calls).toEqual([['a'], ['b']]);
  });

  it('only selects due pending rows with no parked reason (never auto-retries any parked row)', async () => {
    const { worker, calls } = make([]);
    await worker.sweep();

    const { sql, params } = new PgDialect().sqlToQuery(calls.where!);
    expect(sql).toContain('"haip_post_outbox"."status" = $1');
    expect(sql).toContain('"haip_post_outbox"."parked_reason" is null');
    expect(params).toContain('pending');
    expect(sql).not.toContain('last_error');
  });

  it('a db error is logged and returns 0 instead of throwing', async () => {
    const worker = new OutboxWorker(
      { select: () => { throw new Error('db down'); } } as unknown as Db,
      {} as HaipConfig,
      { enqueue } as unknown as HaipQueue,
      {} as OutboxProcessor,
    );
    await expect(worker.sweep()).resolves.toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
