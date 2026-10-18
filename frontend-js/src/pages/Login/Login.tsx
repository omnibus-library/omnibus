import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, login } from "../../api";
import { AuthShell, Emphasis } from "../../components/AuthShell/AuthShell";
import { Banner } from "../../components/Banner/Banner";
import { Button } from "../../components/Button/Button";
import { Field } from "../../components/Field/Field";
import { BusyLabel } from "../../components/Loading/Loading";
import { meQuery } from "../../session";

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
    <AuthShell
      kicker="Sign in"
      title={
        <>
          Welcome <Emphasis>back</Emphasis>
        </>
      }
      lede="Continue to your library."
    >
      <form className="auth-form-inner" onSubmit={onSubmit}>
        {signIn.isError && (
          <Banner kind="err" title={loginErrorMessage(signIn.error)} />
        )}
        <Field
          id="login-username"
          label="Username"
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
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="auth-submit"
          disabled={!username || !password || signIn.isPending}
          aria-busy={signIn.isPending}
        >
          <BusyLabel
            busy={signIn.isPending}
            label="Log in"
            busyLabel="Logging in…"
          />
        </Button>
        <div className="auth-footer-note">omnibus · react proof of concept</div>
      </form>
    </AuthShell>
  );
}
