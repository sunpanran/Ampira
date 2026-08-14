import { createBatchTransition } from "./batch-transition.mjs";

const ACTIVE_CLASS = "is-summary-batch-transitioning";

export function createSummaryBatchTransition(options) {
  return createBatchTransition({ ...options, activeClass: ACTIVE_CLASS });
}
