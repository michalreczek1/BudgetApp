import assert from 'node:assert/strict';
import {
  isSalaryLikeIncomeEntry,
  getIncomeEffectiveMonthValue,
  isIncomeInEffectiveMonth
} from '../js/income-effective-month.js';

function createEntry({ date, name = '' }) {
  return { date, name };
}

assert.equal(isSalaryLikeIncomeEntry(createEntry({ date: '2026-02-28', name: 'Pensja' })), true);
assert.equal(isSalaryLikeIncomeEntry(createEntry({ date: '2026-02-28', name: 'WYNAGRODZENIE marzec' })), true);
assert.equal(isSalaryLikeIncomeEntry(createEntry({ date: '2026-02-28', name: 'Premia' })), false);
assert.equal(isSalaryLikeIncomeEntry(createEntry({ date: '2026-02-28' })), false);

assert.equal(getIncomeEffectiveMonthValue(createEntry({ date: '2026-02-28', name: 'Pensja' })), '2026-03');
assert.equal(getIncomeEffectiveMonthValue(createEntry({ date: '2026-03-28', name: 'Wynagrodzenie marzec' })), '2026-04');
assert.equal(getIncomeEffectiveMonthValue(createEntry({ date: '2026-03-27', name: 'pensja' })), '2026-03');
assert.equal(getIncomeEffectiveMonthValue(createEntry({ date: '2026-03-28', name: 'Premia' })), '2026-03');

assert.equal(isIncomeInEffectiveMonth(createEntry({ date: '2026-02-28', name: 'Pensja' }), '2026-03'), true);
assert.equal(isIncomeInEffectiveMonth(createEntry({ date: '2026-02-28', name: 'Pensja' }), '2026-02'), false);

console.log('income-effective-month tests: OK');
