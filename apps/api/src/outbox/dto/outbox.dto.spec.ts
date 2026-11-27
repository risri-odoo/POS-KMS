import { describe, expect, it } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { ListOutboxDto, ResolveOutboxDto, RetryOutboxDto } from './outbox.dto.js';

// The same pipe settings as main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });
const query = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'query', metatype });
const messages = async (value: unknown, meta: ArgumentMetadata) => {
  try {
    await pipe.transform(value, meta);
    return [];
  } catch (error) {
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  }
};

describe('ResolveOutboxDto', () => {
  it('needs a resolution type and a note', async () => {
    const m = await messages({}, body(ResolveOutboxDto));
    expect(m.join(' ')).toContain('resolutionType must be one of the following values: posted_manually, collected_otherwise, written_off, duplicate_or_error');
    expect(m.join(' ')).toContain('note must be longer than or equal to 3 characters');
  });

  it('trims the note, so blanks do not count', async () => {
    expect(await messages({ resolutionType: 'written_off', note: '   ok   ' }, body(ResolveOutboxDto))).toEqual(['note must be longer than or equal to 3 characters']);
    const dto = (await pipe.transform({ resolutionType: 'written_off', note: '  Comped by manager  ' }, body(ResolveOutboxDto))) as ResolveOutboxDto;
    expect(dto.note).toBe('Comped by manager');
  });

  it('accepts each type, and a charge id (the service checks it goes with posted_manually)', async () => {
    for (const resolutionType of ['posted_manually', 'collected_otherwise', 'written_off', 'duplicate_or_error']) {
      expect(await messages({ resolutionType, note: 'Done at desk' }, body(ResolveOutboxDto))).toEqual([]);
    }
    expect(await messages({ resolutionType: 'posted_manually', note: 'On folio', haipChargeId: 'chg-1' }, body(ResolveOutboxDto))).toEqual([]);
  });

  it('rejects an unknown type, a note over 500 characters and unknown fields', async () => {
    expect((await messages({ resolutionType: 'forgiven', note: 'x'.repeat(3) }, body(ResolveOutboxDto))).join(' ')).toContain('resolutionType');
    expect((await messages({ resolutionType: 'written_off', note: 'x'.repeat(501) }, body(ResolveOutboxDto))).join(' ')).toContain('500');
    expect((await messages({ resolutionType: 'written_off', note: 'Comped', status: 'posted' }, body(ResolveOutboxDto))).join(' ')).toContain('property status should not exist');
  });
});

describe('RetryOutboxDto', () => {
  it('the note is optional', async () => {
    expect(await messages({}, body(RetryOutboxDto))).toEqual([]);
    expect(await messages({ note: 'Room number fixed' }, body(RetryOutboxDto))).toEqual([]);
    expect((await messages({ note: 'x'.repeat(501) }, body(RetryOutboxDto))).join(' ')).toContain('500');
  });
});

describe('ListOutboxDto', () => {
  const P = 'a0000001-0000-4000-a000-000000000001';
  it('accepts the filters and turns limit into a number', async () => {
    const dto = (await pipe.transform({ propertyId: P, view: 'all', parkedReason: 'stay_ended', resolutionType: 'written_off', limit: '20' }, query(ListOutboxDto))) as ListOutboxDto;
    expect(dto).toMatchObject({ view: 'all', parkedReason: 'stay_ended', resolutionType: 'written_off', limit: 20 });
  });

  it('rejects unknown filter values and a limit out of range', async () => {
    expect((await messages({ propertyId: P, view: 'some' }, query(ListOutboxDto))).join(' ')).toContain('view');
    expect((await messages({ propertyId: P, resolutionType: 'forgiven' }, query(ListOutboxDto))).join(' ')).toContain('resolutionType');
    expect((await messages({ propertyId: P, limit: '0' }, query(ListOutboxDto))).join(' ')).toContain('limit');
    expect((await messages({ propertyId: P, limit: '501' }, query(ListOutboxDto))).join(' ')).toContain('limit');
  });
});
