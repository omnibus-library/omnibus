import { ApiError } from "../../api";

/** A refused sign-up, and the part of the form its message belongs under. */
export type Refusal = {
  field: "username" | "password" | "banner";
  message: string;
};

/** Places a sign-up refusal; keyed on words, as the Dioxus page is, so rewording still lands. */
export function refusalOf(error: Error): Refusal {
  // A throttled sign-up answers with the login limiter's generic body.
  if (error instanceof ApiError && error.status === 429) {
    return {
      field: "banner",
      message: "Too many sign-in attempts. Wait a moment and try again.",
    };
  }
  const message = error.message;
  const lower = message.toLowerCase();
  if (lower.includes("username") || lower.includes("user already")) {
    return { field: "username", message };
  }
  return { field: lower.includes("password") ? "password" : "banner", message };
}
