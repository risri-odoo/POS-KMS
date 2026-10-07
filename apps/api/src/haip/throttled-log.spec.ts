import { describe, it, expect, vi } from 'vitest';
import { throttledLog } from './throttled-log.js';

describe('throttledLog', () => {
  it('emits each message at most once per window and reports suppressed repeats', () => {
    let t = 0;
    const emit = vi.fn();
    const log = throttledLog(emit, 1000, () => t);

    for (let i = 0; i < 500; i++) log('redis down');
    log('other error');
    expect(emit.mock.calls).toEqual([['redis down'], ['other error']]);

    t = 1500;
    log('redis down');
    expect(emit).toHaveBeenLastCalledWith('redis down (repeated 499 more times)');
  });
});
