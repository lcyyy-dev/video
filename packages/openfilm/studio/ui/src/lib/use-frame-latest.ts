import { useEffect, useMemo, useRef } from 'react';
import { frameLatest } from './frame-latest';

export function useFrameLatest<T>(apply: (value: T) => void) {
  const latest = useRef(apply);
  latest.current = apply;
  const queue = useMemo(() => frameLatest<T>(value => latest.current(value)), []);
  useEffect(() => () => queue.cancel(), [queue]);
  return queue;
}
