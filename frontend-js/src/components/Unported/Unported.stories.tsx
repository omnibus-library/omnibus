import type { Story, StoryDefault } from "@ladle/react";
import { ButtonLink } from "../Button/Button";
import { Unported } from "./Unported";

export default { title: "Components / Unported" } satisfies StoryDefault;

export const Plain: Story = () => (
  <Unported title="Authors" source="frontend/src/pages/authors_index.rs" />
);

export const WithParams: Story = () => (
  <Unported
    title="PDF reader"
    source="frontend/src/pages/pdf_reader/"
    params={{
      uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
      page: "7",
      file_id: null,
    }}
  >
    <ButtonLink to="/">Back to the book</ButtonLink>
  </Unported>
);
