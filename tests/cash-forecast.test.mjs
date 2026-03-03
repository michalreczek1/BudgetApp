import assert from 'node:assert/strict';
import { calculateAvailableCashForecast } from '../js/cash-forecast.js';

function createDateOffset(days) {
  const date = new Date('2026-03-10T12:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function createPayment({
  id,
  amount,
  date,
  frequency = 'once',
  paidDates = [],
  months = [],
  name = ''
}) {
  return { id, amount, date, frequency, paidDates, months, type: 'expense', name };
}

function createIncome({
  id,
  amount,
  date,
  frequency = 'once',
  receivedDates = [],
  category = 'premia',
  name = ''
}) {
  return { id, amount, date, frequency, receivedDates, category, type: 'income', name };
}

const TODAY = new Date('2026-03-10T12:00:00');

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [],
    incomes: [],
    today: TODAY
  });

  assert.equal(result.availableCash, 1000);
  assert.equal(result.reserveAmount, 0);
  assert.equal(result.horizonType, 'end-of-month');
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [createPayment({ id: 1, amount: 300, date: createDateOffset(2) })],
    incomes: [createIncome({ id: 1, amount: 1200, date: createDateOffset(5) })],
    today: TODAY
  });

  assert.equal(result.availableCash, 700);
  assert.equal(result.reserveAmount, 300);
  assert.equal(result.nextIncomeDate, createDateOffset(5));
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [createPayment({ id: 1, amount: 600, date: createDateOffset(10) })],
    incomes: [createIncome({ id: 1, amount: 500, date: createDateOffset(3) })],
    today: TODAY
  });

  assert.equal(result.reserveAmount, 0);
  assert.equal(result.availableCash, 1000);
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [
      createPayment({ id: 1, amount: 200, date: createDateOffset(1) }),
      createPayment({ id: 2, amount: 300, date: createDateOffset(3) })
    ],
    incomes: [createIncome({ id: 1, amount: 700, date: createDateOffset(5) })],
    today: TODAY
  });

  assert.equal(result.reserveAmount, 500);
  assert.equal(result.availableCash, 500);
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [createPayment({ id: 1, amount: 400, date: createDateOffset(-2) })],
    incomes: [createIncome({ id: 1, amount: 700, date: createDateOffset(4) })],
    today: TODAY
  });

  assert.equal(result.reserveAmount, 400);
  assert.equal(result.reservedOccurrences[0].isOverdue, true);
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [
      createPayment({ id: 1, amount: 200, date: '2026-03-15' }),
      createPayment({ id: 2, amount: 300, date: '2026-03-27' })
    ],
    incomes: [],
    today: TODAY
  });

  assert.equal(result.horizonType, 'end-of-month');
  assert.equal(result.reserveAmount, 500);
  assert.equal(result.availableCash, 500);
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [createPayment({ id: 1, amount: 400, date: '2026-03-10' })],
    incomes: [createIncome({ id: 1, amount: 500, date: '2026-03-10' })],
    today: TODAY
  });

  assert.equal(result.horizonType, 'next-income');
  assert.equal(result.reserveAmount, 400);
  assert.equal(result.availableCash, 600);
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [createPayment({ id: 1, amount: 400, date: '2026-03-12', paidDates: ['2026-03-12'] })],
    incomes: [createIncome({ id: 1, amount: 500, date: '2026-03-15' })],
    today: TODAY
  });

  assert.equal(result.reserveAmount, 0);
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [createPayment({ id: 1, amount: 400, date: '2026-03-12' })],
    incomes: [
      createIncome({ id: 1, amount: 500, date: '2026-03-11', receivedDates: ['2026-03-11'] }),
      createIncome({ id: 2, amount: 600, date: '2026-03-20' })
    ],
    today: TODAY
  });

  assert.equal(result.nextIncomeDate, '2026-03-20');
}

{
  const result = calculateAvailableCashForecast({
    balance: 1000,
    payments: [
      createPayment({
        id: 1,
        amount: 250,
        date: '2026-01-15',
        frequency: 'selected',
        months: [3, 6, 9]
      })
    ],
    incomes: [createIncome({ id: 1, amount: 700, date: '2026-03-20' })],
    today: TODAY
  });

  assert.equal(result.reserveAmount, 250);
  assert.equal(result.reservedOccurrences[0].occurrenceDate, '2026-03-15');
}

console.log('cash-forecast tests: OK');
