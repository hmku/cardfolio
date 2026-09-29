"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CreditState } from "../lib/core/credits";
import type { Credit, Holding } from "../lib/core/model";
import { useDialogFocus } from "./useDialogFocus";
import { CheckIcon } from "./ui";
import { money, shortDate, fullDate } from "../lib/presentation/format";

export type CellTarget = { credit: Credit; holding: Holding };

const LONG_PRESS_MS = 450;

type CellProps = {
  credit: Credit;
  state: CreditState;
  due: boolean;
  label: string;
  onToggle: () => void;
  onMenu: (anchor: DOMRect) => void;
};

/** One credit on one card. Tap toggles used; press-and-hold or right-click opens more options. */
export function CreditCell({ credit, state, due, label, onToggle, onMenu }: CellProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const openMenu = () => { if (button.current) onMenu(button.current.getBoundingClientRect()); };
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  let className = "cell";
  let content: React.ReactNode = null;
  let description = "not used";
  if (state.kind === "off") {
    className += " off";
    content = "–";
    description = "not enrolled";
  } else if (state.kind === "used") {
    className += " used";
    content = <CheckIcon />;
    description = "used";
  } else if (state.kind === "partial") {
    className += " partial";
    content = <span className="num">{money(state.usedCents)}</span>;
    description = `${money(state.usedCents)} of ${money(credit.amountCents)} used`;
  }
  if (due) className += " due";

  let title = `${label}: ${description}`;
  if (state.kind !== "off") {
    title += state.period.label === "Card year" ? ` · card year ends ${fullDate(state.period.end)}` : ` · ${state.period.label} ends ${shortDate(state.period.end)}`;
    const last = state.uses[state.uses.length - 1];
    if (last?.recordedBy) title += ` · marked by ${last.recordedBy}${last.usedOn ? ` on ${shortDate(last.usedOn)}` : ""}`;
  }

  return (
    <button
      ref={button}
      type="button"
      className={className}
      aria-label={title}
      title={title}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        longPressed.current = false;
        timer.current = setTimeout(() => { longPressed.current = true; openMenu(); }, LONG_PRESS_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => { event.preventDefault(); cancel(); openMenu(); }}
      onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.key === "Enter" && event.shiftKey)) { event.preventDefault(); openMenu(); } }}
      onClick={(event) => {
        event.stopPropagation();
        if (longPressed.current) { longPressed.current = false; return; }
        if (state.kind === "off") openMenu();
        else onToggle();
      }}
    >
      {content}
    </button>
  );
}

type MenuProps = {
  credit: Credit;
  state: CreditState;
  heading: string;
  anchor: DOMRect;
  onUse: (amountCents: number | null) => void;
  onEnroll: (enrolled: boolean) => void;
  onClose: () => void;
};

export function CreditMenu({ credit, state, heading, anchor, onUse, onEnroll, onClose }: MenuProps) {
  const [amount, setAmount] = useState(state.kind === "partial" ? String(state.usedCents / 100) : "");
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, onClose);

  const width = 256;
  const left = Math.min(Math.max(8, anchor.left - 100), window.innerWidth - width - 8);
  const top = anchor.bottom + 236 > window.innerHeight ? Math.max(8, anchor.top - 236) : anchor.bottom + 6;
  const savePartial = (event: FormEvent) => {
    event.preventDefault();
    const dollars = Number(amount);
    if (!dollars || dollars <= 0) return;
    onUse(Math.min(Math.round(dollars * 100), credit.amountCents));
  };

  return (
    <>
      <div className="menu-scrim" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="pop" role="dialog" aria-modal="true" aria-label={`${credit.name} options`} style={{ left, top, width }}>
        <div>
          <h3>{credit.name} · {money(credit.amountCents)}</h3>
          <p>{heading}{state.kind !== "off" && ` · ${state.period.label} ends ${shortDate(state.period.end)}`}</p>
        </div>
        {state.kind !== "off" && (
          <>
            <button type="button" className="opt" onClick={() => onUse(credit.amountCents)}>Used in full ({money(credit.amountCents)})</button>
            <form onSubmit={savePartial}>
              <input id="partial-amount" type="number" min="0.01" step="0.01" max={credit.amountCents / 100} inputMode="decimal" placeholder="Amount used ($)" aria-label="Amount used in dollars" value={amount} onChange={(event) => setAmount(event.target.value)} />
              <button type="submit" className="btn small">Save</button>
            </form>
          </>
        )}
        <button type="button" className="opt" onClick={() => onEnroll(state.kind === "off")}>
          {state.kind === "off" ? "Track this credit on this card" : "Not enrolled on this card"}
        </button>
        {(state.kind === "used" || state.kind === "partial") && <button type="button" className="opt" onClick={() => onUse(null)}>Clear this period</button>}
      </div>
    </>
  );
}
