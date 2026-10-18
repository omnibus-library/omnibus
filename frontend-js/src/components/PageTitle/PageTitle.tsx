/** The browser-tab title, `Omnibus | <page>`; React hoists it into `<head>`. */
export function PageTitle({ page }: { page?: string }) {
  return <title>{page ? `Omnibus | ${page}` : "Omnibus"}</title>;
}
