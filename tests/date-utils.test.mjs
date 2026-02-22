import assert from 'node:assert/strict';
import {
  parseDateString,
  formatDateString,
  formatDateToPolish,
  parseUserDateToISO
} from '../date-utils.js';

function isInvalidDate(date) {
  return !(date instanceof Date) || Number.isNaN(date.getTime());
}

{
  const d = parseDateString('2026-02-22');
  assert.equal(isInvalidDate(d), false);
  assert.equal(formatDateString(d), '2026-02-22');
}

{
  const d = parseDateString('22/02/2026');
  assert.equal(isInvalidDate(d), false);
  assert.equal(formatDateString(d), '2026-02-22');
}

{
  const d = parseDateString('22-2-2026');
  assert.equal(isInvalidDate(d), false);
  assert.equal(formatDateString(d), '2026-02-22');
}

{
  const d = parseDateString('31/02/2026');
  assert.equal(isInvalidDate(d), true);
}

{
  const d = parseDateString('2026-13-01');
  assert.equal(isInvalidDate(d), true);
}

assert.equal(parseUserDateToISO('22/02/2026'), '2026-02-22');
assert.equal(parseUserDateToISO('2026-02-22'), '2026-02-22');
assert.equal(parseUserDateToISO(''), null);
assert.equal(parseUserDateToISO('31/02/2026'), null);

assert.equal(formatDateToPolish('2026-02-22'), '22.02.2026');
assert.equal(formatDateToPolish('22/02/2026'), '22.02.2026');
assert.equal(formatDateToPolish('invalid'), '');

console.log('date-utils tests: OK');
