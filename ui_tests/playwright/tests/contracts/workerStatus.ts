/** The endpoint the worker status indicator polls once a second. */
export const workerStatusUrls = {
  poll: /\/api\/rpc\/worker_status(?:\?|$)/,
};
