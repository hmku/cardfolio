"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SeriesPoint } from "../lib/core/investments";
import { moneyWhole, niceTicks, percent, signedMoney, signedPercent, tickLabels, timeAxisLabels } from "../lib/presentation/finance-format";
import { fullDate } from "../lib/presentation/format";
import { AccountName } from "./FinanceAccounts";

/**
 * Hand-rolled SVG charts for the Accounts and Investments pages (no chart library).
 * Colors come from the --chart-* tokens in globals.css, so light and dark both work.
 */

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The element's width, tracked from whenever it mounts (a callback ref: the plot appears only once there are points). */
function useWidth<T extends HTMLElement>() {
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

const PAD = { top: 10, right: 12, bottom: 24, left: 56 };

/**
 * A single-series line chart of daily balances (oldest first) with a crosshair tooltip,
 * arrow-key navigation and a "Show data" table. Fewer than two points shows a note instead.
 */
export function LineChart({ points, label, height = 190, emptyText }: { points: SeriesPoint[]; label: string; height?: number; emptyText?: string }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotHeight = height - PAD.top - PAD.bottom;
  const plotWidth = Math.max(width - PAD.left - PAD.right, 10);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((point) => point.valueCents);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const low = ticks[0], high = ticks[ticks.length - 1];
    const t0 = toTime(points[0].date), t1 = toTime(points[points.length - 1].date);
    const x = (date: string) => PAD.left + ((toTime(date) - t0) / Math.max(t1 - t0, DAY)) * plotWidth;
    const y = (value: number) => PAD.top + (1 - (value - low) / Math.max(high - low, 1)) * plotHeight;
    const coords = points.map((point) => [x(point.date), y(point.valueCents)] as const);
    const line = coords.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
    const bottom = PAD.top + plotHeight;
    const area = `${line}L${coords[coords.length - 1][0].toFixed(1)},${bottom}L${coords[0][0].toFixed(1)},${bottom}Z`;
    const labelCount = plotWidth < 260 ? 2 : plotWidth < 480 ? 3 : 5;
    const xLabels = timeAxisLabels(points.map((point) => point.date), labelCount).map((tick) => ({
      px: PAD.left + plotWidth * tick.fraction,
      text: tick.text,
      anchor: tick.fraction === 0 ? "start" : tick.fraction === 1 ? "end" : "middle",
    }));
    return { ticks, tickText: tickLabels(ticks), y, coords, line, area, xLabels };
  }, [points, plotWidth, plotHeight]);

  if (points.length < 2) {
    return (
      <div className="fchart-empty">
        <p>{emptyText || "Not enough history to draw a chart yet."}</p>
        {points.length === 1 && <p className="hint">One balance so far: {moneyWhole(points[0].valueCents)} on {fullDate(points[0].date)}. A point is added every day.</p>}
      </div>
    );
  }

  const nearest = (clientX: number, rect: DOMRect) => {
    if (!geometry) return null;
    const px = clientX - rect.left;
    let best = 0;
    for (let index = 1; index < geometry.coords.length; index += 1) {
      if (Math.abs(geometry.coords[index][0] - px) < Math.abs(geometry.coords[best][0] - px)) best = index;
    }
    return best;
  };
  const onMove = (event: PointerEvent<SVGSVGElement>) => setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setActive((current) => Math.min(Math.max((current ?? (step < 0 ? points.length : -1)) + step, 0), points.length - 1));
    } else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(points.length - 1); }
    else if (event.key === "Escape") setActive(null);
  };
  const point = active === null ? null : points[active];
  const coord = active === null || !geometry ? null : geometry.coords[active];
  const last = geometry?.coords[geometry.coords.length - 1];

  return (
    <div className="fchart">
      <div className="fchart-plot" ref={wrap} style={{ height }}>
        {width > 0 && geometry && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label}: ${moneyWhole(points[0].valueCents)} on ${fullDate(points[0].date)} to ${moneyWhole(points[points.length - 1].valueCents)} on ${fullDate(points[points.length - 1].date)}. Use the arrow keys to read each day.`}
            tabIndex={0}
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {geometry.ticks.map((tick, index) => (
              <g key={tick}>
                <line className="fchart-grid" x1={PAD.left} x2={PAD.left + plotWidth} y1={geometry.y(tick)} y2={geometry.y(tick)} />
                <text className="fchart-tick" x={PAD.left - 8} y={geometry.y(tick)} dy="0.32em" textAnchor="end">{geometry.tickText[index]}</text>
              </g>
            ))}
            {geometry.xLabels.map((tick) => (
              <text key={tick.px} className="fchart-tick" x={tick.px} y={height - 6} textAnchor={tick.anchor as "start" | "middle" | "end"}>{tick.text}</text>
            ))}
            <path className="fchart-area" d={geometry.area} />
            <path className="fchart-line" d={geometry.line} />
            {last && active === null && <circle className="fchart-dot" cx={last[0]} cy={last[1]} r={4} />}
            {coord && (
              <>
                <line className="fchart-cross" x1={coord[0]} x2={coord[0]} y1={PAD.top} y2={PAD.top + plotHeight} />
                <circle className="fchart-dot" cx={coord[0]} cy={coord[1]} r={4} />
              </>
            )}
          </svg>
        )}
        {point && coord && (
          <div className="fchart-tip" style={{ left: Math.min(Math.max(coord[0], 70), width - 70), top: 0 }} aria-live="polite">
            <strong className="num">{moneyWhole(point.valueCents)}</strong>
            <span>{fullDate(point.date)}</span>
          </div>
        )}
      </div>
      <details className="fchart-table">
        <summary>Show data</summary>
        <div className="fchart-table-scroll">
          <table>
            <thead><tr><th>Date</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {[...points].reverse().map((row) => (
                <tr key={row.date}><td>{fullDate(row.date)}</td><td className="num r">{moneyWhole(row.valueCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Ranked horizontal bars (one color): label, bar, value and share. For allocation lists. */
export function BarList({ items, label }: { items: { key: string; label: string; sub?: string; valueCents: number; share: number }[]; label: string }) {
  const max = Math.max(...items.map((item) => item.share), 0);
  return (
    <ul className="barlist" aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <span className="barlist-label"><AccountName label={item.label} />{item.sub && <small>{item.sub}</small>}</span>
          <span className="barlist-track" aria-hidden="true">
            <span className="barlist-bar" style={{ width: `${max > 0 ? Math.max((Math.max(item.share, 0) / max) * 100, 1) : 0}%` }} />
          </span>
          <span className="barlist-value num">{moneyWhole(item.valueCents)}<small>{percent(item.share)}</small></span>
        </li>
      ))}
    </ul>
  );
}

/** A gain or change with its sign (never color alone): green up, red down. */
export function Change({ cents, percent: share }: { cents: number; percent?: number | null }) {
  const tone = cents > 0 ? "up" : cents < 0 ? "down" : "";
  const pct = share === undefined ? "" : signedPercent(share);
  return <span className={`change num ${tone}`}>{signedMoney(cents)}{pct ? ` (${pct})` : ""}</span>;
}
