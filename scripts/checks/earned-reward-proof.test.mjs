import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {verifyRecordedReward} from '../verify-earned-reward.mjs';
const read=name=>readFile(new URL('../../'+name,import.meta.url),'utf8').then(JSON.parse);
const [evidence,manifest,receipts,deployment]=await Promise.all([
 read('docs/evidence/rewards-20760.json'),read('docs/evidence/rewards-20760-manifest.json'),read('docs/evidence/rewards-20760-receipts.json'),read('deployments/robinhood-testnet.json'),
]);
test('recorded public receipts match the earned allocation and exact token transfer',()=>{const r=verifyRecordedReward(evidence,manifest,receipts,deployment);assert.equal(r.epoch,20760);assert.equal(r.amount,'1532.570312341986489842');});
test('a reverted claim is rejected',()=>{const r=structuredClone(receipts);r.claim.status='reverted';assert.throws(()=>verifyRecordedReward(evidence,manifest,r,deployment));});
test('a different token emitting the same event cannot satisfy transfer evidence',()=>{const r=structuredClone(receipts);for(const log of r.claim.logs)if(log.address.toLowerCase()===evidence.token.toLowerCase())log.address='0x'+'1'.repeat(40);assert.throws(()=>verifyRecordedReward(evidence,manifest,r,deployment));});
test('a successful claim without a recipient token transfer is rejected',()=>{const r=structuredClone(receipts);r.claim.logs=r.claim.logs.filter(log=>log.address.toLowerCase()!==evidence.token.toLowerCase());assert.throws(()=>verifyRecordedReward(evidence,manifest,r,deployment));});
test('funding and claim transaction hashes cannot be substituted',()=>{const e=structuredClone(evidence);e.funding.transaction=e.claim.transaction;assert.throws(()=>verifyRecordedReward(e,manifest,receipts,deployment));});
test('the isolated smoke epoch cannot stand in for the earned epoch',()=>{const e=structuredClone(evidence);e.epoch=20759;assert.throws(()=>verifyRecordedReward(e,manifest,receipts,deployment));});
test('tampered recipient or reward amounts fail allocation verification',()=>{for(const change of [m=>m.allocations[0].address='0x'+'2'.repeat(40),m=>m.allocations[0].amount='1']){const m=structuredClone(manifest);change(m);assert.throws(()=>verifyRecordedReward(evidence,m,receipts,deployment));}});
test('a different distributor or recorded block hash is rejected',()=>{for(const change of [e=>e.distributor='0x'+'3'.repeat(40),e=>e.claim.blockHash='0x'+'0'.repeat(64)]){const e=structuredClone(evidence);change(e);assert.throws(()=>verifyRecordedReward(e,manifest,receipts,deployment));}});
