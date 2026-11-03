"use client";

import { useState, type CSSProperties } from "react";

/** A round merchant logo, or the emoji when there's none (or it fails to load). */
export function MerchantIcon({ logoUrl, emoji, className, style }: { logoUrl?: string | null; emoji: string; className: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    // Plaid's merchant logos are small remote images; next/image would need their host configured.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <span className={className} aria-hidden="true" style={style}>{emoji}</span>;
}
