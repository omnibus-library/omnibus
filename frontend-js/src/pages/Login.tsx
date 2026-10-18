import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import brandMark from "../../../frontend/assets/omnibus-stoat.png";
import { ApiError, login } from "../api";
import { BusyLabel } from "../atrium";
import { meQuery } from "../session";

const SPINES = [
  "oklch(0.66 0.13 245)",
  "oklch(0.70 0.13 95)",
  "oklch(0.55 0.11 145)",
  "oklch(0.74 0.08 220)",
  "oklch(0.55 0.14 35)",
  "oklch(0.45 0.15 295)",
  "oklch(0.78 0.09 75)",
  "oklch(0.55 0.12 165)",
  "oklch(0.60 0.14 30)",
];

function loginErrorMessage(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  switch (error.status) {
    case 401:
      return "Wrong username or password.";
    case 429:
      return "Too many attempts. Wait a minute and try again.";
    default:
      return error.message;
  }
}

function ShelfArt() {
  return (
    <aside className="auth-shell-art">
      <div className="auth-shell-brand">
        <img className="auth-shell-brand-mark" src={brandMark} alt="" />
        <div className="auth-shell-brand-word">Omnibus</div>
      </div>
      <div className="auth-shell-shelf" aria-hidden="true">
        <div className="auth-shell-spines">
          {SPINES.map((background, i) => (
            <div
              key={background}
              className={`auth-shell-spine auth-shell-spine-${i}`}
              style={{ background }}
            >
              <span className="auth-shell-spine-dot" />
            </div>
          ))}
        </div>
        <div className="auth-shell-shelf-plank" />
      </div>
      <div className="auth-shell-tagline">
        <h1 className="auth-shell-headline">
          Your <span className="auth-shell-headline-em">shelf</span>, anywhere.
        </h1>
        <p className="auth-shell-blurb">
          One library for ebooks, audiobooks, journals and quotes — synced
          across the devices you already own.
        </p>
        <div className="auth-shell-meta">
          <span>self-hosted</span>
          <span>·</span>
          <span>open source</span>
          <span>·</span>
          <span>made with react</span>
        </div>
      </div>
    </aside>
  );
}

type FieldProps = {
  id: string;
  label: string;
  type: "text" | "password";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
};

function Field({ id, label, type, autoComplete, value, onChange }: FieldProps) {
  return (
    <div className="auth-field auth-field-neutral">
      <div className="auth-field-label-row">
        <label className="auth-field-label" htmlFor={id}>
          {label}
        </label>
      </div>
      <div className="auth-field-input-wrap">
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function Login() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(meQuery.queryKey, user);
      navigate("/", { replace: true });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate({ username, password });
  }

  return (
    <div className="auth-shell-grid">
      <ShelfArt />
      <section className="auth-shell-form">
        <div className="auth-shell-form-inner">
          <div className="auth-shell-kicker">Sign in</div>
          <h2 className="auth-shell-title">
            Welcome <span className="auth-shell-headline-em">back</span>
          </h2>
          <p className="auth-shell-lede">Continue to your library.</p>
          <div className="auth-shell-body">
            <form className="auth-form-inner" onSubmit={onSubmit}>
              {signIn.isError && (
                <div className="auth-banner auth-banner-err" role="alert">
                  <div className="auth-banner-icon">!</div>
                  <div className="auth-banner-body">
                    <div className="auth-banner-title">
                      {loginErrorMessage(signIn.error)}
                    </div>
                  </div>
                </div>
              )}
              <Field
                id="login-username"
                label="Username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={setUsername}
              />
              <Field
                id="login-password"
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
              <button
                className="btn primary lg auth-submit"
                type="submit"
                disabled={!username || !password || signIn.isPending}
                aria-busy={signIn.isPending}
              >
                <BusyLabel
                  busy={signIn.isPending}
                  label="Log in"
                  busyLabel="Logging in…"
                />
              </button>
              <div className="auth-footer-note">
                omnibus · react proof of concept
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
