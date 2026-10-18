import { AuthShell, Emphasis } from "../../components/AuthShell/AuthShell";
import { ButtonLink } from "../../components/Button/Button";
import { PageTitle } from "../../components/PageTitle/PageTitle";

export function Register() {
  return (
    <AuthShell
      kicker="Create account"
      title={
        <>
          Join the <Emphasis>library</Emphasis>
        </>
      }
      lede="Not ported yet. Dioxus source: frontend/src/pages/auth/register.rs"
    >
      <PageTitle page="Register" />
      <ButtonLink to="/login">Back to sign in</ButtonLink>
    </AuthShell>
  );
}
