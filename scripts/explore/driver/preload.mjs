// Preloaded into every driver's Node process (`node --import`), ahead of
// playwright-repl, for the two things the REPL does not do for itself.
//
// A command that leaves a rejecting promise unawaited — a `.then()` chain that
// is not the command's own result — used to reject unhandled, and Node exited,
// taking the agent's browser, session and guard with it (#2485). A listener
// keeps the process up; `driver.sh run` reports the rejection with the next
// result, so the agent still learns its step failed.
//
// The same buffer holds what the page logs (capture.js), which is what
// `driver.sh console` reads (#2520).
const LIMIT = 1000;

globalThis.__omnibusLog = [];
globalThis.__omnibusUnhandled = [];
globalThis.__omnibusLogPush = (entry) => {
  const log = globalThis.__omnibusLog;
  log.push({ at: new Date().toISOString(), ...entry });
  if (log.length > LIMIT) log.splice(0, log.length - LIMIT);
};

process.on("unhandledRejection", (reason) => {
  const text = reason instanceof Error ? reason.message : String(reason);
  globalThis.__omnibusUnhandled.push(text);
  globalThis.__omnibusLogPush({ source: "driver", type: "error", text: `unhandled rejection: ${text}` });
  console.error("unhandled rejection (driver kept running):", reason);
});
