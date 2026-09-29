"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

const FOCUSABLE = "button, input, select, textarea, a[href], [tabindex]";

/** Focus once per opening, trap Tab in the topmost dialog, and restore the opener. */
export function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    const controls = () => Array.from(element?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter((node) => !node.matches(":disabled, [tabindex='-1']") && node.getClientRects().length > 0);
    (controls()[0] ?? element)?.focus();
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        const active = document.activeElement;
        if (!first) { event.preventDefault(); element?.focus(); }
        else if (event.shiftKey && (active === first || !element?.contains(active))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (active === last || !element?.contains(active))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [panel]);
}
