import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import {
  ApiError,
  type Credentials,
  CredentialsSchema,
  register,
  registerErrorField,
} from "../../api";
import { AuthShell, Emphasis } from "../../components/AuthShell/AuthShell";
import { Banner } from "../../components/Banner/Banner";
import { Button } from "../../components/Button/Button";
import { Field } from "../../components/Field/Field";
import { BusyLabel } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { StrengthMeter } from "../../components/StrengthMeter/StrengthMeter";
import { scorePassword } from "../../password";
import { meQuery, registrationQuery } from "../../session";
import "./Register.css";

/** `/register`: create an account, unless an admin has closed sign-up. */
export function Register() {
  const open = useQuery(registrationQuery);
  return (
    <AuthShell
      kicker="Create account"
      title={
        <>
          Make <Emphasis>yourself</Emphasis> at home
        </>
      }
      lede="Set up your account to start using Omnibus."
    >
      <PageTitle page="Register" />
      {open.data === undefined && (
        <div
          className="auth-form-inner auth-form-pending"
          data-testid="register-pending"
          role="status"
          aria-busy="true"
        >
          <span className="sr-only">
            Checking whether registration is open…
          </span>
        </div>
      )}
      {open.data === false && <RegistrationClosed />}
      {open.data === true && <RegisterForm />}
    </AuthShell>
  );
}

function RegistrationClosed() {
  return (
    <div className="auth-form-inner" data-testid="register-closed">
      <Banner kind="info" title="Registration is closed" />
      <p className="auth-closed-note">
        This server isn't accepting new accounts. Ask an administrator to create
        one for you.
      </p>
      <p className="auth-footer">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}

// Throttled sign-ups answer with the login limiter's generic body.
function refusalMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Too many sign-in attempts. Wait a moment and try again.";
  }
  return error.message;
}

function RegisterForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<Credentials>({
    resolver: zodResolver(CredentialsSchema),
    mode: "onChange",
    defaultValues: { username: "", password: "" },
  });
  const signUp = useMutation({
    mutationFn: register,
    onSuccess: (user) => {
      queryClient.setQueryData(meQuery.queryKey, user);
      navigate("/", { replace: true });
    },
  });
  const refusal = signUp.error ? refusalMessage(signUp.error) : null;
  const field = refusal ? registerErrorField(refusal) : null;
  const errorFor = (name: "username" | "password" | "banner") =>
    field === name && refusal ? refusal : undefined;
  const banner = errorFor("banner");
  // Editing a field clears the refusal, so the reader can try again.
  const editing = (onChange: (value: string) => void) => (value: string) => {
    signUp.reset();
    onChange(value);
  };
  return (
    <form
      className="auth-form-inner"
      data-testid="register-form"
      onSubmit={form.handleSubmit((credentials) => signUp.mutate(credentials))}
    >
      {banner && <Banner kind="err" title={banner} />}
      <Controller
        name="username"
        control={form.control}
        render={({ field: input }) => (
          <Field
            id="register-username"
            label="Username"
            autoComplete="username"
            value={input.value}
            onChange={editing(input.onChange)}
            error={errorFor("username")}
          />
        )}
      />
      <Controller
        name="password"
        control={form.control}
        render={({ field: input }) => (
          <>
            <Field
              id="register-password"
              label="Password"
              type="password"
              autoComplete="new-password"
              value={input.value}
              onChange={editing(input.onChange)}
              error={errorFor("password")}
            />
            <StrengthMeter strength={scorePassword(input.value)} />
          </>
        )}
      />
      <label className="auth-checkbox auth-checkbox-block">
        <input type="checkbox" />
        <span>
          I understand that the server admin can see my reading list, ratings,
          journals on shared shelves, and audiobook play position.
        </span>
      </label>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="auth-submit"
        disabled={
          !form.formState.isValid || signUp.isPending || refusal !== null
        }
        aria-busy={signUp.isPending}
      >
        <BusyLabel
          busy={signUp.isPending}
          label={refusal ? "Fix to continue" : "Create account"}
          busyLabel="Creating…"
        />
      </Button>
      <p className="auth-footer">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}
