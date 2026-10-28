import { Field } from "@base-ui/react/field";
import type { ComponentProps, ReactNode } from "react";

/** A labeled input; extra props go to the <input>. */
export function TextField({
  label,
  description,
  ...input
}: { label: string; description?: ReactNode } & ComponentProps<"input">) {
  return (
    <Field.Root className="flex flex-col gap-1.5">
      <Field.Label className="text-[12px] font-medium text-ink-2">{label}</Field.Label>
      <Field.Control className="input" {...input} />
      {description && (
        <Field.Description className="text-[12px] text-ink-3">{description}</Field.Description>
      )}
    </Field.Root>
  );
}

export function Button({
  children,
  variant = "default",
  small,
  ...button
}: {
  variant?: "default" | "primary" | "danger" | "ghost";
  small?: boolean;
} & ComponentProps<"button">) {
  const base = `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${
    small ? "h-[28px] px-2.5 text-[12.5px]" : "h-[32px] px-3 text-[13px]"
  }`;
  const styles = {
    default: "border border-line bg-card text-ink hover:bg-hover active:bg-selected",
    primary: "bg-accent text-white hover:brightness-110 active:brightness-95",
    danger: "border border-bad/20 bg-bad/5 text-bad hover:bg-bad/10",
    ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  };
  return (
    <button type="button" className={`${base} ${styles[variant]}`} {...button}>
      {children}
    </button>
  );
}
