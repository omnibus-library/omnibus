// Buffers what the agent's browser logs, for `driver.sh console` (#2520).
// `driver.sh` runs this as soon as a server starts, so an error logged before
// any agent thinks to ask is still there. It listens on the browser context
// from the driver's side, so nothing is injected into the page under test.
(() => {
  const push = globalThis.__omnibusLogPush;
  if (!push) return "no-preload";
  if (globalThis.__omnibusConsoleBound) return "capturing";
  context.on("console", (message) => {
    push({ source: "console", type: message.type(), text: message.text(), url: message.page()?.url() ?? "" });
  });
  context.on("weberror", (webError) => {
    const error = webError.error();
    push({ source: "page", type: "error", text: error.stack || error.message, url: webError.page()?.url() ?? "" });
  });
  globalThis.__omnibusConsoleBound = true;
  return "capturing";
})()
