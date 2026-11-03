"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An element's width, tracked from whenever it mounts. A callback ref, so it follows an element
 * that appears later or is replaced (e.g. a plot drawn only once there are points).
 */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    setWidth(element.clientWidth);
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.current.observe(element);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width] as const;
}
