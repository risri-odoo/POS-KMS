/**
 * Returns a logger function that emits a given message at most once per
 * `windowMs`, counting suppressed repeats. Connection errors (Redis down,
 * reconnect loops) can fire many times a second; this keeps them readable.
 */
export function throttledLog(
  emit: (message: string) => void,
  windowMs = 60_000,
  now: () => number = Date.now,
): (message: string) => void {
  const lastByMessage = new Map<string, { at: number; suppressed: number }>();
  return (message: string) => {
    const t = now();
    const last = lastByMessage.get(message);
    if (last && t - last.at < windowMs) {
      last.suppressed += 1;
      return;
    }
    const suffix = last?.suppressed ? ` (repeated ${last.suppressed} more times)` : '';
    lastByMessage.set(message, { at: t, suppressed: 0 });
    if (lastByMessage.size > 100) lastByMessage.delete(lastByMessage.keys().next().value!);
    emit(message + suffix);
  };
}
