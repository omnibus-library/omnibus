import { AuthShell, Emphasis } from "../../components/AuthShell/AuthShell";
import { ButtonLink } from "../../components/Button/Button";
import { PageTitle } from "../../components/PageTitle/PageTitle";

export function Connect() {
  return (
    <AuthShell
      kicker="Connect"
      title={
        <>
          Find your <Emphasis>server</Emphasis>
        </>
      }
      lede="Not ported yet. Dioxus source: frontend/src/pages/server_connect.rs"
    >
      <PageTitle page="Connect" />
      <ButtonLink to="/login">Back to sign in</ButtonLink>
    </AuthShell>
  );
}
