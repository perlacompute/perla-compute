import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { TESTNET_SUPPLY, cumulativeBudget, dailyBudget, emissionPreview } from '../../lib/perla/emission.mjs';

test('daily budgets conserve the cumulative curve through four years', () => {
  let sum = 0n, previous = TESTNET_SUPPLY;
  for (let day = 1; day <= 1460; day++) {
    const budget = dailyBudget(day);
    assert(budget > 0n && budget <= previous);
    sum += budget;
    assert.equal(sum, cumulativeBudget(day));
    previous = budget;
  }
  assert.equal(sum, TESTNET_SUPPLY / 2n);
});

test('long schedule remains capped without floating point overflow', () => {
  assert.equal(cumulativeBudget(0), 0n);
  for (const day of [1, 365, 1460, 1000000, Number.MAX_SAFE_INTEGER]) {
    assert(cumulativeBudget(day) > 0n && cumulativeBudget(day) < TESTNET_SUPPLY);
    assert(dailyBudget(day) >= 0n);
  }
});

test('invalid and imprecise day inputs are rejected before budgeting', () => {
  for (const day of [-1, 0, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => dailyBudget(day));
  assert.throws(() => cumulativeBudget(-1));
});

test('CLI can preview testnet budgets without wallet secrets or network access', () => {
  const result = spawnSync(process.execPath, ['scripts/perla-rewards.mjs', 'emission', '1460'], {
    cwd: new URL('../../', import.meta.url), encoding:'utf8',
    env:{...process.env, PERLA_PRIVATE_KEY:'', PERLA_ENDPOINT:'', PERLA_OPERATOR_TOKEN:''},
  });
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.chainId, 46630);
  assert.equal(preview.cumulativeBudgetBaseUnits, (TESTNET_SUPPLY / 2n).toString());
  assert.match(preview.status, /not a funded/);
  assert.equal(emissionPreview(1).dailyBudgetBaseUnits, dailyBudget(1).toString());
});

test('CLI refuses malformed preview arguments', () => {
  for (const value of ['0', '-1', '2.5', '9007199254740992']) {
    const result = spawnSync(process.execPath, ['scripts/perla-rewards.mjs', 'emission', value], { cwd:new URL('../../',import.meta.url), encoding:'utf8' });
    assert.notEqual(result.status, 0);
  }
});
