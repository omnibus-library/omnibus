let sequence = 0;

/** A suffix no other call returns, in this worker or any other. */
export function uniqueSuffix(): string {
  sequence += 1;
  return `${Date.now()}-${process.pid}-${sequence}`;
}

/** Nine digits that differ between workers and between calls in one. */
export function uniqueDigits(): string {
  sequence += 1;
  const time = String(Date.now()).slice(-5);
  const worker = String(process.pid % 1000).padStart(3, "0");
  return `${time}${worker}${sequence % 10}`;
}
