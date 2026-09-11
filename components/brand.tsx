"use client";

import type { LucideIcon } from "lucide-react";
import { clsx } from "./clsx";
import { Firefly } from "./plate";

export function Wordmark({ size = "md", onClick }: { size?: "md" | "sm"; onClick?: () => void }) {
  const small = size === "sm";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-2.5 text-left"
      aria-label="Firefly Feeds — a quiet place to read the web"
    >
      <Firefly size={small ? 6 : 7} pulse className={small ? "mt-[5px]" : "mt-[6px]"} />
      <span className="flex min-w-0 flex-col">
        {/* One name, one size. The strapline below does the differentiating. */}
        <span
          className={clsx(
            "display leading-[1] font-semibold tracking-[-0.022em] whitespace-nowrap text-ink",
            small ? "text-[17px]" : "text-[19px]",
          )}
        >
          Firefly Feeds
        </span>
        <span
          className={clsx(
            "mono mt-1.5 truncate tracking-[0.12em] text-ink4 uppercase",
            small ? "text-[7px]" : "text-[8px]",
          )}
        >
          A quiet place to read
        </span>
      </span>
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  size = 26,
  iconSize = 15,
  strokeWidth = 1.6,
  className,
  href,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  iconSize?: number;
  strokeWidth?: number;
  className?: string;
  href?: string;
}) {
  const classes = clsx(
    "inline-flex items-center justify-center transition-colors duration-150",
    active ? "bg-sparksoft text-spark" : "text-ink3 hover:bg-hoverc hover:text-ink",
    disabled && "pointer-events-none opacity-35",
    className,
  );
  const style = { width: size, height: size };

  if (href && !disabled) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        aria-label={label}
        className={classes}
        style={style}
      >
        <Icon size={iconSize} strokeWidth={strokeWidth} />
      </a>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={classes}
      style={style}
    >
      <Icon size={iconSize} strokeWidth={strokeWidth} />
    </button>
  );
}

/** Horizontal hairline that reads as a printed rule rather than a border. */
export function Rule({ className }: { className?: string }) {
  return <div className={clsx("h-px w-full bg-rule", className)} />;
}
