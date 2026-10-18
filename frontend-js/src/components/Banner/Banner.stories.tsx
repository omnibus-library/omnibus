import type { Story, StoryDefault } from "@ladle/react";
import { Button } from "../Button/Button";
import { Banner, type BannerKind } from "./Banner";

export default { title: "Components / Banner" } satisfies StoryDefault;

const KINDS: BannerKind[] = ["err", "warn", "info", "ok"];

export const Kinds: Story = () => (
  <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
    {KINDS.map((kind) => (
      <Banner key={kind} kind={kind} title={`A ${kind} banner`} />
    ))}
  </div>
);

export const WithMessage: Story = () => (
  <div style={{ maxWidth: 420 }}>
    <Banner
      kind="warn"
      title="Registration is closed"
      message="Ask an admin for an account."
    />
  </div>
);

export const WithAction: Story = () => (
  <div style={{ maxWidth: 420 }}>
    <Banner kind="err" title="Couldn't reach the server">
      <Button size="sm">Try again</Button>
    </Banner>
  </div>
);
