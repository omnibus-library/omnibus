import { type ExpectMutationOptions, post } from "../utils/api";

/** The server function the chart builder plots through. */
export const chartBuilderUrls = {
  series: /\/api\/rpc\/chart-series(?:\?|$)/,
};

export const chartBuilder = {
  /** The chart read, a POST because it is a server function. */
  series: (): ExpectMutationOptions => post(chartBuilderUrls.series),
};
