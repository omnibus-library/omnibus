import type { Story, StoryDefault } from "@ladle/react";
import { ButtonLink } from "../Button/Button";
import { DiscPage } from "./DiscPage";

export default { title: "Components / DiscPage" } satisfies StoryDefault;

export const WithHero: Story = () => (
  <DiscPage>
    <h1 className="disc-hero-title">Page not found</h1>
    <p className="subtitle">Nothing lives at /no/such/page.</p>
    <ButtonLink to="/">Back to library</ButtonLink>
  </DiscPage>
);
