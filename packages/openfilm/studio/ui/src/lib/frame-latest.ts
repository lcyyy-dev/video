/** Coalesce high frequency input to one update per display frame, retaining the
 * latest value. flush() commits the final input synchronously on pointer release. */
export function frameLatest<T>(apply: (value: T) => void, schedule = requestAnimationFrame, unschedule = cancelAnimationFrame) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (frame !== null) unschedule(frame);
    frame = null;
    const next = pending;
    pending = null;
    if (next) apply(next.value);
  };
  return {
    enqueue(value: T) {
      pending = { value };
      if (frame === null) frame = schedule(() => { frame = null; flush(); });
    },
    flush,
    cancel() {
      if (frame !== null) unschedule(frame);
      frame = null; pending = null;
    },
  };
}
