import assert from 'node:assert/strict';
import test from 'node:test';
import {publicNetworkState} from '../../lib/perla/public-status.mjs';
test('unknown and failed coordinator reads never advertise public admission',()=>{assert.equal(publicNetworkState(null).tone,'neutral');const state=publicNetworkState({miningEnabled:true,launch:{phase:'live'}},true);assert.equal(state.tone,'neutral');assert.equal(state.label,'Status unavailable');});
test('a public launch marker cannot override a paused mining switch',()=>{const state=publicNetworkState({miningEnabled:false,launch:{phase:'live'}});assert.equal(state.label,'Work admission paused');assert.equal(state.tone,'neutral');});
test('operator-only validation does not appear as public mining',()=>{const state=publicNetworkState({miningEnabled:true,launch:{phase:'testing'}});assert.equal(state.label,'Validation in progress');assert.equal(state.tone,'neutral');});
test('public admission requires a live phase and enabled coordinator',()=>{const state=publicNetworkState({miningEnabled:true,launch:{phase:'live'}});assert.equal(state.label,'Public testnet open');assert.equal(state.tone,'green');assert.notEqual(publicNetworkState({miningEnabled:true}).label,state.label);});
