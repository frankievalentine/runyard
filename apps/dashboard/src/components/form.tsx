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
    // Every button but the primary one has an edge you can see in both themes.
    default:
      "border border-line-strong bg-card text-ink shadow-[0_1px_1px_rgb(0_0_0/0.04)] hover:bg-hover active:bg-selected",
    primary: "bg-accent text-white hover:brightness-110 active:brightness-95",
    danger: "border border-bad/40 bg-bad/5 text-bad hover:bg-bad/10",
    // Quieter than default (no fill), for secondary actions such as Cancel and Ignore.
    ghost: "border border-line-strong/70 text-ink-2 hover:bg-hover hover:text-ink",
  };
  return (
    <button type="button" className={`${base} ${styles[variant]}`} {...button}>
      {children}
    </button>
  );
}

/** A radio or checkbox option as a card: a title and a line on what it means. */
export function Choice({
  type,
  name,
  checked,
  onChange,
  title,
  detail,
  disabled,
}: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-[12.5px] ${checked ? "border-accent bg-accent/5" : "border-line hover:bg-hover"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type={type}
        name={name}
        className="mt-[3px] shrink-0"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-[12px] text-ink-2">{detail}</span>
      </span>
    </label>
  );
}
