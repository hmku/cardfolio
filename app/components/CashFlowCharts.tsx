"use client";

import { useEffect, useRef, useState } from "react";
import type { CashFlowMonth } from "../lib/core/finance";
import { moneyWhole } from "../lib/presentation/finance-format";
import { monthYear } from "../lib/presentation/format";
import { moneyCompact } from "./FinanceChart";

/**
 * Hand-rolled SVG charts for the Cash flow tab: the monthly income/spending chart, the
 * income → spending flow diagram and the segmented share bar. Colors come from the --cf-* and
 * --cat-* tokens in globals.css (validated for both themes), or a category's own color.
 */

const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthName = (month: string) => shortMonth.format(new Date(`${month}-15T00:00:00Z`));
export const percent = (share: number) => `${Math.round(share * 100)}%`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A step of 1, 2, 2.5 or 5 × a power of ten, at least `rough`. */
function niceStep(rough: number) {
  if (rough <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((step) => step >= rough) ?? rough;
}

/** A bar from the baseline y0 to y1 with a 4px rounded data end and a square foot. */
function barPath(x: number, width: number, y0: number, y1: number) {
  const length = Math.abs(y1 - y0);
  if (length < 0.5) return "";
  const dir = y1 < y0 ? -1 : 1;
  const radius = Math.min(4, length, width / 2);
  const bend = y1 - dir * radius;
  return `M${x},${y0}V${bend}Q${x},${y1} ${x + radius},${y1}H${x + width - radius}Q${x + width},${y1} ${x + width},${bend}V${y0}Z`;
}

/**
 * Income above the baseline, spending below it and net as a line, one slot per month. Each slot
 * is a button: hover or focus shows the month's numbers, a click picks the month.
 */
export function MonthChart({ months, selected, onSelect }: { months: CashFlowMonth[]; selected: string | null; onSelect: (month: string) => void }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const narrow = width < 520;
  const height = narrow ? 210 : 250;
  const pad = { top: 10, right: 2, bottom: 24, left: narrow ? 40 : 48 };
  const plotWidth = Math.max(width - pad.left - pad.right, 10);
  const plotHeight = height - pad.top - pad.bottom;

  const high = Math.max(0, ...months.map((month) => Math.max(month.incomeCents, month.netCents)));
  const low = Math.max(0, ...months.map((month) => Math.max(month.expenseCents, -month.netCents)));
  const step = niceStep((high + low) / 4);
  const top = Math.ceil(high / step) * step || step;
  const bottom = Math.ceil(low / step) * step;
  const ticks: number[] = [];
  for (let tick = -bottom; tick <= top + step / 2; tick += step) ticks.push(tick);
  const y = (cents: number) => pad.top + ((top - cents) / (top + bottom)) * plotHeight;
  const band = plotWidth / Math.max(months.length, 1);
  const center = (index: number) => pad.left + band * (index + 0.5);
  const barWidth = Math.max(6, Math.min(24, band * 0.52));
  const letters = band < 30;
  const shown = active === null ? null : months[active];
  const net = months.map((month, index) => `${index ? "L" : "M"}${center(index).toFixed(1)},${y(month.netCents).toFixed(1)}`).join("");

  return (
    <figure className="cf-chart">
      <div className="cf-legend" aria-hidden="true">
        <span><i className="cf-swatch income" />Income</span>
        <span><i className="cf-swatch spend" />Spending</span>
        <span><i className="cf-key net" />Net</span>
      </div>
      <div className="cf-plot" ref={wrap} style={{ height }} onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={height} aria-hidden="true">
            {selected !== null && months.some((month) => month.month === selected) && (
              <rect className="cf-band selected" x={center(months.findIndex((month) => month.month === selected)) - band / 2 + 1} y={pad.top - 6} width={band - 2} height={plotHeight + 12 + pad.bottom - 4} rx={8} />
            )}
            {active !== null && months[active].month !== selected && (
              <rect className="cf-band" x={center(active) - band / 2 + 1} y={pad.top - 6} width={band - 2} height={plotHeight + 12 + pad.bottom - 4} rx={8} />
            )}
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={`fchart-grid${tick === 0 ? " cf-zero" : ""}`} x1={pad.left} x2={width - pad.right} y1={Math.round(y(tick)) + 0.5} y2={Math.round(y(tick)) + 0.5} />
                <text className="fchart-tick" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{moneyCompact(tick)}</text>
              </g>
            ))}
            {months.map((month, index) => {
              const dim = selected !== null && month.month !== selected && index !== active;
              const x = center(index) - barWidth / 2;
              return (
                <g key={month.month} className={dim ? "cf-dim" : undefined}>
                  <path className="cf-bar income" d={barPath(x, barWidth, y(0) - 1, y(Math.max(month.incomeCents, 0)) - 1)} />
                  <path className="cf-bar spend" d={barPath(x, barWidth, y(0) + 1, y(-Math.max(month.expenseCents, 0)) + 1)} />
                  <text className={`cf-month-label${month.month === selected ? " selected" : ""}`} x={center(index)} y={height - 6} textAnchor="middle">
                    {letters ? monthName(month.month).slice(0, 1) : month.month.endsWith("-01") && !narrow ? `${monthName(month.month)} ’${month.month.slice(2, 4)}` : monthName(month.month)}
                  </text>
                </g>
              );
            })}
            <path className="cf-net" d={net} />
            {months.map((month, index) => (
              <circle key={month.month} className="cf-net-dot" cx={center(index)} cy={y(month.netCents)} r={month.month === selected || index === active ? 5 : 3.5} />
            ))}
          </svg>
        )}
        <div className="cf-hits" style={{ left: pad.left, right: pad.right }}>
          {months.map((month, index) => (
            <button
              key={month.month}
              type="button"
              aria-pressed={month.month === selected}
              aria-label={`${monthYear(`${month.month}-01`)}: income ${moneyWhole(month.incomeCents)}, spending ${moneyWhole(month.expenseCents)}, net ${moneyWhole(month.netCents)}`}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onClick={() => onSelect(month.month)}
            />
          ))}
        </div>
        {shown && active !== null && (
          <div className={`cf-tooltip${active >= months.length / 2 ? " left" : ""}`} style={{ left: active >= months.length / 2 ? center(active) - band / 2 - 4 : center(active) + band / 2 + 4 }} role="status">
            <strong>{monthYear(`${shown.month}-01`)}</strong>
            <span><i className="cf-key income" /><b className="num">{moneyWhole(shown.incomeCents)}</b> income</span>
            <span><i className="cf-key spend" /><b className="num">{moneyWhole(shown.expenseCents)}</b> spending</span>
            <span><i className="cf-key net" /><b className="num">{moneyWhole(shown.netCents)}</b> net{shown.incomeCents > 0 ? ` · ${percent(shown.netCents / shown.incomeCents)} saved` : ""}</span>
          </div>
        )}
      </div>
      <details className="fchart-table">
        <summary>Show as table</summary>
        <div className="fchart-table-scroll">
          <table>
            <thead><tr><th>Month</th><th className="r">Income</th><th className="r">Spending</th><th className="r">Net</th></tr></thead>
            <tbody>
              {[...months].reverse().map((month) => (
                <tr key={month.month}><td>{monthYear(`${month.month}-01`)}</td><td className="num r">{moneyWhole(month.incomeCents)}</td><td className="num r">{moneyWhole(month.expenseCents)}</td><td className="num r">{moneyWhole(month.netCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export type FlowItem = {
  key: string;
  label: string;
  emoji?: string | null;
  cents: number;
  /** A CSS color: a token like var(--cat-2) or a category's own hex. */
  color: string;
  onOpen?: () => void;
};

type Placed = FlowItem & { slotTop: number; slot: number; nodeTop: number; nodeHeight: number; offset: number };

/** Stack items in a column: bars proportional to the amount, each in a slot tall enough for its label. */
function place(items: FlowItem[], scale: number, gap: number, minSlot: number) {
  let top = 0;
  let offset = 0;
  const placed: Placed[] = items.map((item) => {
    const nodeHeight = Math.max(item.cents * scale, 2);
    const slot = Math.max(nodeHeight, minSlot);
    const row = { ...item, slotTop: top, slot, nodeTop: top + (slot - nodeHeight) / 2, nodeHeight, offset };
    top += slot + gap;
    offset += item.cents * scale;
    return row;
  });
  return { placed, height: Math.max(top - gap, 0) };
}

function ribbon(x0: number, a0: number, a1: number, x1: number, b0: number, b1: number) {
  const mid = (x0 + x1) / 2;
  return `M${x0},${a0}C${mid},${a0} ${mid},${b0} ${x1},${b0}L${x1},${b1}C${mid},${b1} ${mid},${a1} ${x0},${a1}Z`;
}

/**
 * Where the money went: income sources flow into one income bar, which fans out into spending
 * categories and savings. On narrow screens the sources column is left out (the bar is the start).
 */
export function FlowDiagram({ sources, targets, totalCents, centerLabel, centerNote, percentOf }: { sources: FlowItem[]; targets: FlowItem[]; totalCents: number; centerLabel: string; centerNote?: string; percentOf: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const wide = width >= 640;
  const nodeWidth = 10;
  const gap = 6;
  const minSlot = 36;
  const head = 40;
  const labelLeft = wide ? 170 : 0;
  const labelRight = wide ? 210 : Math.min(170, Math.round(width * 0.48));
  const count = Math.max(targets.length, wide ? sources.length : 0, 1);
  const base = wide ? 260 : 270;
  const scale = totalCents > 0 ? (base - gap * (count - 1)) / totalCents : 0;
  const left = place(wide ? sources : [], scale, gap, minSlot);
  // The middle bar is stacked by source (income, then any money taken from savings), so it reads even without the left column.
  const stack = place(sources, scale, 0, 0).placed;
  const right = place(targets, scale, gap, minSlot);
  const centerHeight = totalCents * scale;
  const height = Math.max(left.height, right.height, centerHeight);
  const leftShift = (height - left.height) / 2;
  const rightShift = (height - right.height) / 2;
  const centerTop = (height - centerHeight) / 2;
  const sourceX = labelLeft;
  const targetX = width - labelRight - nodeWidth;
  const centerX = wide ? Math.round((sourceX + targetX) / 2) : 0;
  const share = (cents: number) => (percentOf > 0 ? percent(cents / percentOf) : "");
  const opacity = (key: string) => (hover === null ? undefined : hover === key ? 0.55 : 0.12);

  const label = (item: Placed, side: "left" | "right", shift: number) => {
    const content = (
      <>
        <span className="cf-flow-name">{item.emoji ? `${item.emoji} ` : ""}{item.label}</span>
        <span className="cf-flow-value"><b className="num">{moneyWhole(item.cents)}</b>{share(item.cents) && <span className="num"> · {share(item.cents)}</span>}</span>
      </>
    );
    const style = side === "left"
      ? { top: head + shift + item.slotTop + item.slot / 2, left: 0, width: labelLeft - 10 }
      : { top: head + shift + item.slotTop + item.slot / 2, left: targetX + nodeWidth + 8, width: labelRight - 8 };
    const events = { onPointerEnter: () => setHover(item.key), onPointerLeave: () => setHover(null), onFocus: () => setHover(item.key), onBlur: () => setHover(null) };
    return item.onOpen
      ? <button key={item.key} type="button" className={`cf-flow-label ${side}`} style={style} onClick={item.onOpen} title="Show these transactions" {...events}>{content}</button>
      : <div key={item.key} className={`cf-flow-label ${side}`} style={style} {...events}>{content}</div>;
  };

  return (
    <figure className="cf-flow" ref={wrap} style={{ height: head + height }} aria-label={`${centerLabel}: where it went`}>
      {width > 0 && totalCents > 0 && (
        <>
          <svg width={width} height={head + height} aria-hidden="true">
            <g transform={`translate(0 ${head})`}>
              {left.placed.map((item) => (
                <path key={item.key} className="cf-ribbon" style={{ fill: item.color, fillOpacity: opacity(item.key) }}
                  d={ribbon(sourceX + nodeWidth, leftShift + item.nodeTop, leftShift + item.nodeTop + item.nodeHeight, centerX, centerTop + item.offset, centerTop + item.offset + item.cents * scale)} />
              ))}
              {right.placed.map((item) => (
                <path key={item.key} className="cf-ribbon" style={{ fill: item.color, fillOpacity: opacity(item.key) }}
                  d={ribbon(centerX + nodeWidth, centerTop + item.offset, centerTop + item.offset + item.cents * scale, targetX, rightShift + item.nodeTop, rightShift + item.nodeTop + item.nodeHeight)} />
              ))}
              {left.placed.map((item) => <rect key={item.key} className="cf-node" x={sourceX} y={leftShift + item.nodeTop} width={nodeWidth} height={item.nodeHeight} rx={3} style={{ fill: item.color }} />)}
              <clipPath id="cf-flow-center"><rect x={centerX} y={centerTop} width={nodeWidth} height={centerHeight} rx={3} /></clipPath>
              <g clipPath="url(#cf-flow-center)">
                {stack.map((item) => <rect key={item.key} x={centerX} y={centerTop + item.offset} width={nodeWidth} height={item.cents * scale} style={{ fill: item.color }} />)}
              </g>
              {right.placed.map((item) => <rect key={item.key} className="cf-node" x={targetX} y={rightShift + item.nodeTop} width={nodeWidth} height={item.nodeHeight} rx={3} style={{ fill: item.color }} />)}
            </g>
          </svg>
          <div className={`cf-flow-center${wide ? "" : " start"}`} style={wide ? { left: centerX + nodeWidth / 2, top: Math.max(0, head + centerTop - (centerNote ? 58 : 44)) } : { left: 0 }}>
            <span>{centerLabel}</span>
            <b className="num">{moneyWhole(totalCents)}</b>
            {centerNote && <small>{centerNote}</small>}
          </div>
          {left.placed.map((item) => label(item, "left", leftShift))}
          {right.placed.map((item) => label(item, "right", rightShift))}
        </>
      )}
    </figure>
  );
}

/** `lightFill`: the block is light (yellow) in light mode, so its label is near-black there. */
export type Segment = { key: string; label: string; cents: number; share: number; color: string; lightFill?: boolean };

/** One whole split into parts: a 28px bar of blocks with 2px gaps, the share printed inside blocks wide enough. */
export function SegmentBar({ segments, label }: { segments: Segment[]; label: string }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const shown = segments.find((segment) => segment.key === active);
  return (
    <div className="cf-segments-wrap">
      <div className="cf-segments" ref={wrap} role="img" aria-label={`${label}: ${segments.map((segment) => `${segment.label} ${percent(segment.share)}`).join(", ")}`} onPointerLeave={() => setActive(null)}>
        {segments.map((segment) => (
          <span key={segment.key} className={`cf-segment${segment.lightFill ? " light-fill" : ""}${active && active !== segment.key ? " dim" : ""}`} style={{ flexGrow: segment.cents, background: segment.color }} onPointerEnter={() => setActive(segment.key)}>
            {width * segment.share >= 40 && <span className="num">{percent(segment.share)}</span>}
          </span>
        ))}
      </div>
      {shown && <p className="cf-segment-note" role="status"><b>{shown.label}</b> <span className="num">{moneyWhole(shown.cents)} · {percent(shown.share)}</span></p>}
    </div>
  );
}
