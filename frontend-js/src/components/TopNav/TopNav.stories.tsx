import type { Story, StoryDefault } from "@ladle/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ADA, harnessClient } from "../../testing/AppHarness";
import { TopNav } from "./TopNav";

export default { title: "Components / TopNav" } satisfies StoryDefault;

export const SignedIn: Story = () => <TopNav />;

export const WithoutUploadAccess: Story = () => {
  const [client] = useState(() => harnessClient({ ...ADA, canUpload: false }));
  return (
    <QueryClientProvider client={client}>
      <TopNav />
    </QueryClientProvider>
  );
};
