const test = require('node:test');
const assert = require('node:assert');

const { ADJUST, errorFactors, factorFor } = require('../utils/forecastAdjust');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('adjustment: half of the last miss is corrected', () => {
    const f = errorFactors([{ group: 'Food', forecast: 100, sold: 80 }]);
    near(f.shop, 0.9);
    near(f.groups.Food, 0.9);
    near(errorFactors([{ group: 'Food', forecast: 80, sold: 100 }]).shop, 1.125);
    near(errorFactors([{ group: 'Food', forecast: 50, sold: 50 }]).shop, 1);
});

test('adjustment: the factor is kept between 0.6 and 1.4', () => {
    near(errorFactors([{ group: 'A', forecast: 1000, sold: 20 }]).shop, ADJUST.min);
    near(errorFactors([{ group: 'A', forecast: 10, sold: 500 }]).shop, ADJUST.max);
});

test('adjustment: each category gets its own factor', () => {
    const f = errorFactors([
        { group: 'Food', forecast: 60, sold: 30 }, { group: 'Food', forecast: 40, sold: 30 },
        { group: 'Health', forecast: 50, sold: 50 },
    ]);
    near(f.groups.Food, 0.8);       // 100 forecast, 60 sold
    near(f.groups.Health, 1);
    near(f.shop, 1 + 0.5 * (110 / 150 - 1));
    near(factorFor(f, 'Food'), 0.8);
    near(factorFor(f, 'Toys'), f.shop);     // a category not in the test takes the shop's
    near(factorFor(f, null), f.shop);
});

test('adjustment: a category that sold too little takes the shop factor', () => {
    const f = errorFactors([
        { group: 'Food', forecast: 100, sold: 80 },
        { group: 'Litter', forecast: 12, sold: 4 },
    ]);
    near(f.groups.Food, 0.9);
    near(f.groups.Litter, f.shop);
    assert.equal(f.detail.find(d => d.group === 'Litter').own, false);
    assert.equal(f.detail.find(d => d.group === 'Food').own, true);
});

test('adjustment: too little sold in the whole shop means no adjustment', () => {
    const f = errorFactors([{ group: 'Food', forecast: 40, sold: 10 }, { group: 'Health', forecast: 30, sold: 9 }]);
    near(f.shop, 1);
    near(f.groups.Food, 1);
    near(factorFor(f, 'Health'), 1);
});

test('adjustment: nothing to go on means a factor of 1', () => {
    near(errorFactors([]).shop, 1);
    near(errorFactors(null).shop, 1);
    near(factorFor(null, 'Food'), 1);
    near(errorFactors([{ group: 'Food', forecast: 0, sold: 50 }]).shop, 1);     // nothing was forecast: there is no ratio
});
