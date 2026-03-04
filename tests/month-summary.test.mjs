import assert from 'node:assert/strict';
import { calculateDashboardMonthSummary } from '../js/month-summary.js';

function createPayment({
  id,
  amount,
  date,
  frequency = 'once',
  months = [],
  paidDates = [],
  name = 'Platnosc'
}) {
  return { id, amount, date, frequency, months, paidDates, type: 'expense', name };
}

function createIncome({
  id,
  amount,
  date,
  frequency = 'once',
  receivedDates = [],
  category = 'premia',
  name = 'Wplyw'
}) {
  return { id, amount, date, frequency, receivedDates, category, type: 'income', name };
}

function createEntry({ id, amount, date, category = 'inne', source = 'manual', name = '' }) {
  return { id, amount, date, category, source, name, icon: '' };
}

const TODAY = new Date('2026-03-10T12:00:00');

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    expenseEntries: [],
    incomeEntries: []
  });

  assert.equal(result.currentMonth.plannedIncomeToDate, 0);
  assert.equal(result.currentMonth.realizedIncomeToDate, 0);
  assert.equal(result.currentMonth.plannedExpenseToDate, 0);
  assert.equal(result.currentMonth.realizedExpenseToDate, 0);
  assert.equal(result.currentMonth.balanceToDate, 0);
  assert.equal(result.previousMonth.realizedIncome, 0);
  assert.equal(result.previousMonth.realizedExpense, 0);
  assert.equal(result.previousMonth.balance, 0);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    incomes: [
      createIncome({ id: 1, amount: 5000, date: '2026-03-05' }),
      createIncome({ id: 2, amount: 900, date: '2026-03-15' }),
      createIncome({ id: 3, amount: 1100, date: '2026-01-08', frequency: 'monthly' })
    ],
    payments: [
      createPayment({ id: 1, amount: 700, date: '2026-03-03' }),
      createPayment({ id: 2, amount: 200, date: '2026-03-12' }),
      createPayment({ id: 3, amount: 300, date: '2026-01-09', frequency: 'monthly' }),
      createPayment({ id: 4, amount: 150, date: '2026-01-06', frequency: 'selected', months: [3, 6] })
    ],
    incomeEntries: [],
    expenseEntries: []
  });

  assert.equal(result.currentMonth.plannedIncomeToDate, 6100);
  assert.equal(result.currentMonth.plannedExpenseToDate, 1150);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    incomes: [
      createIncome({ id: 1, amount: 5000, date: '2026-03-05', receivedDates: ['2026-03-05'] }),
      createIncome({ id: 2, amount: 900, date: '2026-03-15' }),
      createIncome({ id: 3, amount: 1100, date: '2026-01-08', frequency: 'monthly', receivedDates: ['2026-03-08'] })
    ],
    payments: [
      createPayment({ id: 1, amount: 700, date: '2026-03-03', paidDates: ['2026-03-03'] }),
      createPayment({ id: 2, amount: 200, date: '2026-03-12' }),
      createPayment({ id: 3, amount: 300, date: '2026-01-09', frequency: 'monthly', paidDates: ['2026-03-09'] }),
      createPayment({ id: 4, amount: 150, date: '2026-01-06', frequency: 'selected', months: [3, 6], paidDates: ['2026-03-06'] })
    ],
    incomeEntries: [
      createEntry({ id: 1, amount: 5000, date: '2026-03-05', category: 'pensja' }),
      createEntry({ id: 2, amount: 1100, date: '2026-03-08', category: 'premia' })
    ],
    expenseEntries: [
      createEntry({ id: 3, amount: 700, date: '2026-03-03', category: 'rachunki' }),
      createEntry({ id: 4, amount: 300, date: '2026-03-09', category: 'jedzenie' }),
      createEntry({ id: 5, amount: 150, date: '2026-03-06', category: 'ubrania' })
    ]
  });

  assert.equal(result.currentMonth.realizedIncomeToDate, 6100);
  assert.equal(result.currentMonth.realizedExpenseToDate, 1150);
  assert.equal(result.currentMonth.plannedIncomeOutstanding, 900);
  assert.equal(result.currentMonth.plannedExpenseOutstanding, 200);
  assert.equal(result.currentMonth.projectedIncome, 7000);
  assert.equal(result.currentMonth.projectedExpense, 1350);
  assert.equal(result.currentMonth.projectedBalance, 5650);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    incomeEntries: [
      createEntry({ id: 1, amount: 5000, date: '2026-02-28', category: 'premia', name: 'Pensja luty' }),
      createEntry({ id: 2, amount: 300, date: '2026-02-28', category: 'premia', name: 'Premia luty' }),
      createEntry({ id: 3, amount: 1200, date: '2026-03-28', category: 'premia', name: 'Wynagrodzenie marzec' })
    ],
    expenseEntries: []
  });

  assert.equal(result.currentMonth.realizedIncomeToDate, 5000);
  assert.equal(result.currentMonth.projectedIncome, 5000);
  assert.equal(result.previousMonth.realizedIncome, 300);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [
      createIncome({
        id: 10,
        amount: 11096,
        date: '2026-02-28',
        frequency: 'monthly',
        receivedDates: ['2026-02-28'],
        category: 'wynagrodzenie',
        name: 'Pensja'
      })
    ],
    incomeEntries: [
      createEntry({
        id: 11,
        amount: 11096,
        date: '2026-02-27',
        category: 'zaplanowane wpływy',
        source: 'planned-income',
        name: '✨ Inne'
      })
    ],
    expenseEntries: []
  });

  assert.equal(result.currentMonth.realizedIncomeToDate, 11096);
  assert.equal(result.previousMonth.realizedIncome, 0);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    incomeEntries: [
      createEntry({ id: 1, amount: 2500, date: '2026-03-01', category: 'premia' }),
      createEntry({ id: 2, amount: 800, date: '2026-03-10', category: 'najem' }),
      createEntry({ id: 3, amount: 400, date: '2026-03-18', category: 'inne' })
    ],
    expenseEntries: [
      createEntry({ id: 4, amount: 200, date: '2026-03-02', category: 'jedzenie' }),
      createEntry({ id: 5, amount: 300, date: '2026-03-10', category: 'paliwo' }),
      createEntry({ id: 6, amount: 100, date: '2026-03-20', category: 'inne' })
    ]
  });

  assert.equal(result.currentMonth.realizedIncomeToDate, 3300);
  assert.equal(result.currentMonth.realizedExpenseToDate, 500);
  assert.equal(result.currentMonth.balanceToDate, 2800);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    incomeEntries: [
      createEntry({ id: 1, amount: 1800, date: '2026-03-04', category: 'zaplanowane wpływy', source: 'planned-income' }),
      createEntry({ id: 2, amount: 1800, date: '2026-03-04', category: 'pensja', source: 'balance-update' }),
      createEntry({ id: 3, amount: 900, date: '2026-02-04', category: 'zaplanowane wpływy', source: 'planned-income' }),
      createEntry({ id: 4, amount: 900, date: '2026-02-04', category: 'premia', source: 'balance-update' })
    ],
    expenseEntries: [
      createEntry({ id: 5, amount: 1200, date: '2026-03-05', category: 'zaplanowane płatności', source: 'planned-payment' }),
      createEntry({ id: 6, amount: 1200, date: '2026-03-05', category: 'jedzenie', source: 'balance-update' }),
      createEntry({ id: 7, amount: 300, date: '2026-02-05', category: 'zaplanowane płatności', source: 'planned-payment' }),
      createEntry({ id: 8, amount: 300, date: '2026-02-05', category: 'rachunki', source: 'balance-update' })
    ]
  });

  assert.equal(result.currentMonth.realizedIncomeToDate, 1800);
  assert.equal(result.currentMonth.realizedExpenseToDate, 1200);
  assert.equal(result.currentMonth.balanceToDate, 600);
  assert.equal(result.previousMonth.realizedIncome, 900);
  assert.equal(result.previousMonth.realizedExpense, 300);
  assert.equal(result.previousMonth.balance, 600);
}

{
  const result = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    incomeEntries: [
      createEntry({ id: 1, amount: 900, date: '2026-02-03', category: 'premia' }),
      createEntry({ id: 2, amount: 300, date: '2026-03-01', category: 'premia' })
    ],
    expenseEntries: [
      createEntry({ id: 3, amount: 450, date: '2026-02-05', category: 'jedzenie' }),
      createEntry({ id: 4, amount: 100, date: '2026-03-02', category: 'jedzenie' })
    ]
  });

  assert.equal(result.previousMonth.realizedIncome, 900);
  assert.equal(result.previousMonth.realizedExpense, 450);
  assert.equal(result.previousMonth.balance, 450);
  assert.equal(result.previousMonth.monthLabel, 'Luty 2026');
}

{
  const positive = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    incomeEntries: [createEntry({ id: 1, amount: 1000, date: '2026-03-08' })],
    expenseEntries: [createEntry({ id: 2, amount: 250, date: '2026-03-07' })]
  });
  const negative = calculateDashboardMonthSummary({
    today: TODAY,
    payments: [],
    incomes: [],
    incomeEntries: [createEntry({ id: 3, amount: 200, date: '2026-03-08' })],
    expenseEntries: [createEntry({ id: 4, amount: 450, date: '2026-03-07' })]
  });

  assert.equal(positive.currentMonth.balanceToDate, 750);
  assert.equal(negative.currentMonth.balanceToDate, -250);
}

console.log('month-summary tests: OK');
