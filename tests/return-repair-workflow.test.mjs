import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../sql/return_repair_workflow_controls.sql', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/team.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/repair.html', import.meta.url), 'utf8');

assert.match(sql, /approve_return_repair_run/);
assert.match(sql, /promote_return_repair_run/);
assert.match(sql, /rollback_return_repair_run/);
assert.match(sql, /activate_strategy_valuation_rule/);
assert.match(sql, /status='ROLLED_BACK'/);
assert.match(api, /verifyUserPassword/);
assert.match(api, /requireMasterAdmin/);
assert.match(api, /return-repair-promote/);
assert.match(api, /confirmation.*ROLLBACK/);
assert.match(page, /Promote &amp; activate/);
assert.match(page, /Rollback promoted run/);
assert.match(page, /workflowPassword/);

console.log('return repair workflow: 12/12 green');
