import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoint the chart builder plots through. */
export const chartBuilderUrls = {
  series: /\/api\/stats\/chart(?:\?|$)/,
};

export const chartBuilder = {
  /** The chart read, a POST because it carries the spec. */
  series: (): ExpectMutationOptions => post(chartBuilderUrls.series),
};
