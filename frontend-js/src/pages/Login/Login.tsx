import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ApiError,
  type Credentials,
  CredentialsSchema,
  login,
} from "../../api";
import { AuthShell, Emphasis } from "../../components/AuthShell/AuthShell";
import { Banner } from "../../components/Banner/Banner";
import { Button } from "../../components/Button/Button";
import { Field } from "../../components/Field/Field";
import { BusyLabel } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { safeNext } from "../../safeNext";
import { meQuery, registrationQuery } from "../../session";

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
  const [search] = useSearchParams();
  const registration = useQuery(registrationQuery);
  const form = useForm<Credentials>({
    resolver: zodResolver(CredentialsSchema),
    mode: "onChange",
    defaultValues: { username: "", password: "" },
  });
  const signIn = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(meQuery.queryKey, user);
      navigate(safeNext(search.get("next")) ?? "/", { replace: true });
    },
  });

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
      <PageTitle page="Sign in" />
      <form
        className="auth-form-inner"
        onSubmit={form.handleSubmit((credentials) =>
          signIn.mutate(credentials),
        )}
      >
        {signIn.isError && (
          <Banner kind="err" title={loginErrorMessage(signIn.error)} />
        )}
        <Controller
          name="username"
          control={form.control}
          render={({ field }) => (
            <Field
              id="login-username"
              label="Username"
              autoComplete="username"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Controller
          name="password"
          control={form.control}
          render={({ field }) => (
            <Field
              id="login-password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="auth-submit"
          disabled={!form.formState.isValid || signIn.isPending}
          aria-busy={signIn.isPending}
        >
          <BusyLabel
            busy={signIn.isPending}
            label="Log in"
            busyLabel="Logging in…"
          />
        </Button>
        {/* Only once the check says open, so a closed server never withdraws it. */}
        {registration.data === true && (
          <p className="auth-footer">
            New here? <Link to="/register">Create an account</Link>
          </p>
        )}
        <div className="auth-footer-note">omnibus · react proof of concept</div>
      </form>
    </AuthShell>
  );
}
