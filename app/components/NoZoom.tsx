"use client";

import { useEffect } from "react";

/**
 * iOS ignores `user-scalable=no`, so block its pinch gestures directly (touch screens only;
 * desktop browser zoom still works). Double-tap zoom is off via `touch-action` in globals.css.
 */
export function NoZoom() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const block = (event: Event) => event.preventDefault();
    const pinch = (event: TouchEvent) => { if (event.touches.length > 1) event.preventDefault(); };
    document.addEventListener("gesturestart", block, { passive: false });
    document.addEventListener("gesturechange", block, { passive: false });
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
      document.removeEventListener("touchmove", pinch);
    };
  }, []);
  return null;
}
