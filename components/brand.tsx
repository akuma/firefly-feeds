"use client";

import type { LucideIcon } from "lucide-react";
import { clsx } from "./clsx";
import { Firefly } from "./plate";

export function Wordmark({
  size = "md",
  onClick,
}: {
  size?: "md" | "sm";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2.5 text-left"
      aria-label="FireflyReader"
    >
      <Firefly size={size === "sm" ? 6 : 7} pulse />
      <span className="flex flex-col justify-center">
        <span
          className={clsx(
            "display leading-[0.86] text-ink",
            size === "sm" ? "text-[18px]" : "text-[21px]",
          )}
        >
          Firefly
        </span>
        <span
          className={clsx(
            "mono uppercase text-ink4 transition-colors group-hover:text-ink3",
            size === "sm" ? "mt-[2px] text-[7.5px] tracking-[0.34em]" : "mt-[3px] text-[8.5px] tracking-[0.34em]",
          )}
        >
          Reader
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
