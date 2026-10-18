import type { Meta, StoryObj } from "@storybook/react-vite";
import { ButtonLink } from "../Button/Button";
import { DiscPage } from "./DiscPage";

const meta = {
  title: "Components/DiscPage",
  component: DiscPage,
} satisfies Meta<typeof DiscPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHero: Story = {
  args: {
    children: (
      <>
        <h1 className="disc-hero-title">Page not found</h1>
        <p className="subtitle">Nothing lives at /no/such/page.</p>
        <ButtonLink to="/">Back to library</ButtonLink>
      </>
    ),
  },
};
