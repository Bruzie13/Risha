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
    assert.equal(priceProblem('1250.50'), null, 'a price typed with two decimals');
    assert.match(priceProblem('+20'), /no \+ or - signs/, 'a plus sign is refused');
    assert.match(priceProblem('1e3'), /number only/, 'no exponent');
    assert.match(priceProblem('20abc'), /number only/);
    assert.match(priceProblem('12.345'), /at most 2 decimals/);
    assert.match(priceProblem(12.345), /at most 2 decimals/, 'sent as a number too');
    assert.equal(priceProblem(''), 'Enter the new price.');
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

test('reorder: a product needs a supplier who is still on the list', () => {
    const { reorderSupplierProblem } = require('../utils/supply');
    const active = new Set([6, 7]);
    assert.equal(reorderSupplierProblem({ id: 1, supplier_id: 6 }, active), null);
    assert.equal(reorderSupplierProblem({ id: 1, supplier_id: '7' }, active), null, 'the id may arrive as text');
    assert.match(reorderSupplierProblem({ id: 1, supplier_id: null }, active), /no supplier assigned/);
    assert.match(reorderSupplierProblem({ id: 1 }, active), /no supplier assigned/);
    assert.match(reorderSupplierProblem({ id: 1, supplier_id: 2 }, active), /has been deleted/, 'the id is set, but that supplier was deleted');
    assert.match(reorderSupplierProblem({ id: 1, supplier_id: 2 }, new Set()), /has been deleted/);
    assert.match(reorderSupplierProblem({ id: 1, supplier_id: 2 }, null), /has been deleted/, 'with no list to check against, nothing is orderable');
});

const { starRating, STAR_RULE } = require('../utils/supply');
test('star rating: one star for delivering, then one for each standard met', () => {
    assert.equal(starRating({ delivered: 0 }).rated, false);
    assert.match(starRating({ delivered: 0 }).summary, /Not rated yet/);
    const best = starRating({ delivered: 10, on_time_percent: 95, on_time_of: 10, complete_percent: 100, average_days: 5 });
    assert.equal(best.stars, 5); assert.equal(best.meets_standard, true);
    const late = starRating({ delivered: 10, on_time_percent: 80, on_time_of: 10, complete_percent: 100, average_days: 5 });
    assert.equal(late.stars, 4, '75% on time earns the first on-time star, not the second'); assert.equal(late.meets_standard, true);
    const poor = starRating({ delivered: 4, on_time_percent: 50, on_time_of: 4, complete_percent: 75, average_days: 12 });
    assert.equal(poor.stars, 1); assert.equal(poor.meets_standard, false); assert.match(poor.summary, /Below the standard: it needs 4 stars or more/);
    const undated = starRating({ delivered: 3, on_time_percent: null, on_time_of: 0, complete_percent: 100, average_days: 6 });
    assert.equal(undated.stars, 3, 'no promised dates: the on-time stars are not given');
    assert.match(undated.checks[1].value, /no order had a promised date/);
});
test('star rating: the edges of each standard count as met', () => {
    const edge = starRating({ delivered: 1, on_time_percent: 90, on_time_of: 1, complete_percent: 90, average_days: 7 });
    assert.equal(edge.stars, 5);
    assert.equal(STAR_RULE.standard, 4);
});
