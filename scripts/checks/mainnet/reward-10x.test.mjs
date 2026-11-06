import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAN,
  TOKEN_UNIT,
  roundLimit,
  roundReward,
  miningBudget,
} from "../../../lib/compute/config.mjs";
test("10x reward conserves the 130M reserve over the original 1460 epochs", () => {
  const pool = 130000000n * TOKEN_UNIT,
    old = pool / 1460n / 48n,
    normal = roundReward(100, 100);
  assert(normal >= old * 10n && normal - old * 10n < 10n);
  let rounds = 0,
    maxEmission = 0n,
    allocated = 0n;
  for (let day = 0; day < 1460; day++) {
    const limit = roundLimit(100 + day, 100);
    assert([4, 5].includes(limit));
    rounds += limit;
    maxEmission += miningBudget(100 + day, 100);
    allocated += roundReward(100 + day, 100) * BigInt(limit);
    assert(
      roundReward(100 + day, 100) * BigInt(limit) <=
        miningBudget(100 + day, 100),
    );
  }
  assert.equal(rounds, 7008);
  assert.equal(maxEmission, pool);
  assert(allocated <= pool && pool - allocated < 5n);
  assert.equal(PLAN.targetSeconds, 18000);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((d) => roundLimit(100 + d, 100)),
    [4, 5, 5, 5, 5],
  );
  assert.equal(roundLimit(99, 100), 0);
  assert.equal(roundLimit(1560, 100), 0);
});
