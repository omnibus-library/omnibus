import type { Story, StoryDefault } from "@ladle/react";
import { PageError, PageNotFound } from "./PageState";

export default { title: "Components / PageState" } satisfies StoryDefault;

export const ErrorState: Story = () => (
  <PageError message="Couldn't load the library: 500 Internal Server Error" />
);

export const NotFoundState: Story = () => (
  <PageNotFound subject="Book" backTo="/" backLabel="Back to library" />
);
