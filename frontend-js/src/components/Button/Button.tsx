import type { ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router";
import { classes } from "../../classes";
import "./Button.css";

export type ButtonVariant = "default" | "primary" | "ghost" | "bad";
export type ButtonSize = "sm" | "md" | "lg";

type Look = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

const VARIANT_CLASS = {
  default: null,
  primary: "primary",
  ghost: "ghost",
  bad: "bad",
} satisfies Record<ButtonVariant, string | null>;

const SIZE_CLASS = {
  sm: "sm",
  md: null,
  lg: "lg",
} satisfies Record<ButtonSize, string | null>;

function buttonClass({ variant = "default", size = "md", className }: Look) {
  return classes("btn", VARIANT_CLASS[variant], SIZE_CLASS[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Look;

/** The Atrium `.btn`. `className` adds a screen's own modifier. */
export function Button({
  variant,
  size,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className })}
      {...rest}
    />
  );
}

/** A router link drawn as a `.btn`. */
export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: LinkProps & Look) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...rest} />
  );
}
