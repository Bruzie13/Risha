const test = require('node:test');
const assert = require('node:assert');
const { termDays, dueDate, promiseProblem, confirmLines, proposalLines, priceProblem, scorecard } = require('../utils/supply');

test('payment terms: read the days out of the usual wordings', () => {
    assert.equal(termDays('Net 30'), 30);
    assert.equal(termDays('net15'), 15);
    assert.equal(termDays('45 days'), 45);
    assert.equal(termDays('Due on Receipt'), 0);
    assert.equal(termDays('COD'), 0);
    assert.equal(termDays(''), null);
    assert.equal(termDays('ask Roger'), null);
});

test('payment due date: received day plus the terms, or unknown', () => {
    assert.equal(dueDate('2026-10-01', 'Net 30'), '2026-10-31');
    assert.equal(dueDate('2026-10-09', 'Due on Receipt'), '2026-10-09');
    assert.equal(dueDate('2026-10-09', 'whenever'), null);
    assert.equal(dueDate(null, 'Net 30'), null);
});

test('promised date: a real day, not past, not absurdly far', () => {
    assert.equal(promiseProblem('2026-10-12', '2026-10-09'), null);
    assert.equal(promiseProblem('2026-10-09', '2026-10-09'), null, 'today is allowed');
    assert.match(promiseProblem('2026-10-08', '2026-10-09'), /past/);
    assert.match(promiseProblem('2028-01-01', '2026-10-09'), /year away/);
    assert.match(promiseProblem('soon', '2026-10-09'), /Choose/);
    assert.match(promiseProblem('2026-13-40', '2026-10-09'), /Choose/);
});

const order = [{ id: 1, quantity: 10, unit_price: 100 }, { id: 2, quantity: 5, unit_price: 40 }];

test('confirm: saying nothing about a line means all of it', () => {
    const r = confirmLines(order, []);
    assert.deepEqual(r.lines, [{ id: 1, confirmed: 10 }, { id: 2, confirmed: 5 }]);
    assert.equal(r.total, 1200);
    assert.equal(r.short, 0);
});

test('confirm: a short line lowers the total and is counted', () => {
    const r = confirmLines(order, [{ id: 1, quantity: 6 }, { id: 2, quantity: 0 }]);
    assert.deepEqual(r.lines, [{ id: 1, confirmed: 6 }, { id: 2, confirmed: 0 }]);
    assert.equal(r.total, 600);
    assert.equal(r.short, 2);
});

test('confirm: never more than ordered, never fractions or negatives, never nothing at all', () => {
    assert.ok(confirmLines(order, [{ id: 1, quantity: 11 }]).error);
    assert.ok(confirmLines(order, [{ id: 1, quantity: -1 }]).error);
    assert.ok(confirmLines(order, [{ id: 1, quantity: 2.5 }]).error);
    assert.ok(confirmLines(order, [{ id: 1, quantity: 'lots' }]).error);
    assert.ok(confirmLines(order, [{ id: 1, quantity: 0 }, { id: 2, quantity: 0 }]).error);
});

test('confirm: a line id that is not on the order changes nothing', () => {
    const r = confirmLines(order, [{ id: 999, quantity: 1 }]);
    assert.equal(r.total, 1200);
});

const own = new Map([[3, 250], [4, 80]]);

test('offer: only the supplier\'s own products, priced at what the shop pays', () => {
    const r = proposalLines([{ product_id: 3, quantity: 4 }, { product_id: 4, quantity: 10 }], own);
    assert.equal(r.total, 1800);
    assert.deepEqual(r.lines[0], { product_id: 3, quantity: 4, unit_price: 250, subtotal: 1000 });
    assert.ok(proposalLines([{ product_id: 99, quantity: 1 }], own).error, 'someone else\'s product');
});

test('offer: sane quantities, no duplicates, not empty', () => {
    assert.ok(proposalLines([], own).error);
    assert.ok(proposalLines([{ product_id: 3, quantity: 0 }], own).error);
    assert.ok(proposalLines([{ product_id: 3, quantity: 10001 }], own).error);
    assert.ok(proposalLines([{ product_id: 3, quantity: 1.5 }], own).error);
    assert.ok(proposalLines([{ product_id: 3, quantity: 1 }, { product_id: 3, quantity: 2 }], own).error);
});

test('price: positive and believable', () => {
    assert.equal(priceProblem(120.5), null);
    assert.ok(priceProblem(0));
    assert.ok(priceProblem(-5));
    assert.ok(priceProblem('free'));
    assert.ok(priceProblem(5000000));
});

test('scorecard: on time is judged against the promise, then the requested date', () => {
    const s = scorecard([
        { ordered_day: '2026-09-01', received_day: '2026-09-05', target_day: '2026-09-05', short_lines: 0 },
        { ordered_day: '2026-09-10', received_day: '2026-09-16', target_day: '2026-09-14', short_lines: 1 },
        { ordered_day: '2026-09-20', received_day: '2026-09-22', target_day: null, short_lines: 0 },
        { ordered_day: '2026-10-01', received_day: null, target_day: '2026-10-05', short_lines: 0 }
    ]);
    assert.equal(s.delivered, 3, 'an order still on its way is not scored');
    assert.equal(s.on_time_of, 2, 'an order with no date to judge against is left out, not passed');
    assert.equal(s.on_time_percent, 50);
    assert.equal(s.complete_percent, 67);
    assert.equal(s.average_days, 4);
});

test('scorecard: nothing delivered yet gives no percentages rather than 0% or 100%', () => {
    const s = scorecard([]);
    assert.equal(s.delivered, 0);
    assert.equal(s.on_time_percent, null);
    assert.equal(s.complete_percent, null);
    assert.equal(s.average_days, null);
});
