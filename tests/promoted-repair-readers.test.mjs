import assert from 'node:assert/strict';
import fs from 'node:fs';

const investors = fs.readFileSync(new URL('../api/investors/data.js', import.meta.url), 'utf8');
const team = fs.readFileSync(new URL('../api/team.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const factsheet = fs.readFileSync(new URL('../public/factsheet.html', import.meta.url), 'utf8');

assert.match(investors, /status=in\.\(VALIDATED,APPROVED,PROMOTED\)/);
assert.match(team, /status=in\.\(VALIDATED,APPROVED,PROMOTED\)/);
assert.match(dashboard, /\['APPROVED', 'PROMOTED'\]\.includes/);
assert.match(factsheet, /\['APPROVED', 'PROMOTED'\]\.includes/);

console.log('promoted repair readers: 4/4 green');
