import { describe, expect, it } from "vitest";

import { merchantBatches, merchantBatchSize } from "@/lib/merchant-batches";

describe("merchantBatchSize", () => {
  it("puts a short list in one request", () => {
    // Sizing batches for the progress bar instead was measured and reverted:
    // a request costs three to ten seconds almost regardless of how many names
    // are in it, and Next runs a client's server actions one at a time, so
    // steps multiply the wait rather than filling it.
    expect(merchantBatchSize(9)).toBe(9);
    expect(merchantBatches(Array.from({ length: 9 }, (_, i) => i))).toHaveLength(1);
  });

  it("stops growing well inside the reply budget", () => {
    // A long list gets more batches, not bigger ones: a reply that runs over
    // the cap is truncated mid-JSON, which loses the whole batch.
    expect(merchantBatchSize(200)).toBe(10);
    expect(merchantBatches(Array.from({ length: 200 }, (_, i) => i))).toHaveLength(20);
  });

  it("gives a long list real steps to report", () => {
    expect(merchantBatches(Array.from({ length: 24 }, (_, i) => i))).toHaveLength(3);
  });
});

describe("merchantBatches", () => {
  it("covers every merchant exactly once, in order", () => {
    const names = Array.from({ length: 37 }, (_, i) => `Shop ${i}`);
    expect(merchantBatches(names).flat()).toEqual(names);
  });

  it("has nothing to slice when there is nothing to file", () => {
    expect(merchantBatches([])).toEqual([]);
  });
});
