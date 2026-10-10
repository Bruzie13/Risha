# How the forecast works

This describes what the code does as of 11 October 2026, after the fixes that followed the QA test report. Every statement here was checked against the code, and every figure was produced by running it. Where the paper, the slides or the test plan say something different, this document is the one that matches the system.

Section 12 lists what to change in the other documents.

---

## 1. In short

- **What is forecast:** how many items of each product will sell on each of the next 30 days.
- **Method:** two machine-learning models from scikit-learn, **Random Forest** and **Gradient Boosting**, fitted once on all products together and averaged. This is the forecast for any product with at least six weeks of sales on record.
- **Around the model:** three guards that run first (days without data are left out, freak days are capped, new products get a cautious estimate), a simple trend for products too new for the model, and a last step that corrects the forecast for how far off it was the time before.
- **How good it is:** on four fortnights it was not shown, the forecast total was 15.6% above what sold (it was 36.4% above before the fixes). Per product per fortnight it misses by 1.40 items on average (was 1.55). That is still about as large as what a product sells in a fortnight, so the forecast is more use for a category or the shop than for one product. Section 9 has the full figures and section 11 the limits.

---

## 2. What it reads

| | |
|---|---|
| Sales used | Completed sales only. A voided sale is not counted. |
| How far back | Up to 365 days. The shop's records start on 28 February 2026, so at present that is 225 days. |
| What a "day" is | The shop's calendar day (Philippine time). Sales are stored in UTC and converted. |
| Today | Left out. The day is not over, so counting it would read a morning's sales as a whole day's. |
| A day with no sale of a product | Counted as zero for that product, from its first sale onward. |
| When it is worked out | When someone opens Stock planning, at most once every 5 minutes. It is also prepared when the server starts. |

At the time of writing: 2,338 completed sales, 4,473 sale lines, 10,370 items, 120 products.

---

## 3. The steps, in order

For each product:

1. Build its daily history (section 2).
2. Leave out days without data (section 4).
3. Cap freak days (section 5).
4. Choose the method by how many days it has on record (section 6):

| Days on record, counted from its first sale | Method | Marked as |
|---|---|---|
| Under 14 | Cautious first estimate | `new` |
| 14 to 41 | Simple trend | `trend` |
| 42 or more | Machine-learning ensemble | `model` |

5. Correct for the forecast's own last miss (section 8). Not applied to a `new` product.

If the Python model cannot run (Python missing, or it fails), every product falls back to the simple trend and the server log says so. The page then shows "statistical baseline only".

Code: `forecastSeries()` in `backend/routes/predictions.js`.

---

## 4. Days without data (the May window)

A day on which nothing sold is normally a real zero and the forecast should learn from it. Two kinds of empty day say nothing about demand:

- days on which sales were recorded but none of them has its items
- three or more days in a row with no sale at all (the shop closed, or nothing was being recorded)

**Rule.** Take each run of days on which no item was sold in the whole shop. The run is left out if any day in it has a completed sale without items, or if it is three days or longer with no sale at all. A run that reaches the last day on record is kept, because recent silence may be real.

**What it finds in the shop's data:** one run, **10 to 31 May 2026, 22 days**. From 10 to 27 May there are 199 sales (#1097 to #1295, ₱1,259,362.00) with no items. 28 to 31 May have no sales at all and belong to the same run.

**What "left out" means.** Those 22 days are dropped from every product's history before any model sees them. The forecast does not learn "nothing sells" from them, and "the last 28 days" means the last 28 days on record. The calendar inputs (day of week, month) and "how many days ahead" are still worked out from the real dates. Nothing in the database is changed: the days are only skipped when read, and the 199 sales are untouched.

**Where it shows.** Stock planning says under its heading: "Not counted: May 10, 2026 to May 31, 2026 (22 days: sales were recorded without their items)." Reports → Sales shows the ₱1,259,362.00 as its own line, "Sales with no items recorded (199)", so that revenue by category adds up to total revenue:

> categories ₱8,847,885.00 + sales with no items ₱1,259,362.00 − discounts ₱123,724.50 = revenue ₱9,983,522.50

**An effect to know about.** Leaving the window out made the two fortnights straight after it look worse in testing (the forecast was 171% and 65% too high). The zero days had been hiding how far sales fell in June. That is why the test windows used for tuning start on 4 July (section 10).

Code: `noDataDays()` in `backend/utils/forecastGuards.js`, `findNoDataDays()` in `backend/routes/predictions.js`.

---

## 5. Freak days (outliers)

One model is fitted for all products together. A single freak day in one product (a mistyped quantity, a one-off bulk purchase) used to bend the forecast of every product.

**Rule.** Before anything is fitted, a day counts for no more than a cap worked out from the product's own history:

> cap = the larger of 5, and 4 × the product's typical selling day

"Typical" is the quantity the product reaches or stays under on three of every four days it sells (the 75th percentile of its selling days). A product with fewer than 5 selling days is judged by the same figure taken across the whole shop.

The 75th percentile is used, not the average, because one extreme day drags an average and a standard deviation up with it.

- On the shop's data the cap clips 6 of 3,971 selling days (0.3% of the items sold).
- A lasting change of level is not clipped: only single days far above the product's usual.
- In the accuracy test the cap is worked out only from the days the test is allowed to see.

**Measured effect** (a made-up product added to the 120 real ones, everything refitted):

| Made-up product | Other products' forecast, before | Now |
|---|---|---|
| Ordinary: 1 a day for 120 days | −3.2% | +3.8% |
| The same with one day of 10,000 | +130% | +4.1% |
| The same with one day of 1,000,000 | +15,044% | +4.1% |
| The same with 300 sold on the last day | +22.8%, 98 products moved more than 10% | +4.1%, 3 products moved more than 10% |

So a freak day now adds 0.3 of a percentage point to the effect the same product would have had anyway. Its own forecast goes from 79,559 (suggested order 98,104) to 26 (no order suggested).

Code: `capSeries()` in `backend/utils/forecastGuards.js`.

---

## 6. The three methods

### 6.1 New product: under 14 days on record

A daily rate cannot be read from a few days. A product that sold 5 on its first day used to be forecast at 5 a day: 150 in 30 days, with an order suggested for 165.

> daily rate = items sold so far ÷ 14

The same figure is given for every day ahead. No trend, no day-of-week pattern and no model is fitted. The low end of the range is 0 and the high end is twice the rate. Confidence reads low.

| Made-up product | Before | Now |
|---|---|---|
| One sale of 1, yesterday | 30 in 30 days | 2.1 |
| One sale of 5, yesterday | 150, "reorder now, order 165" | 10.8, no order |

The estimate rises as more is sold and meets the plain average on day 14, when the simple trend takes over. The page says: "This product has only N days of sales on record, so this is a cautious first estimate…".

### 6.2 Simple trend: 14 to 41 days on record

The model needs 42 days (28 to build its inputs and 14 to learn from). Until then a product is forecast by a simple trend that reads its **last 8 weeks**:

| Part | Share | What it is |
|---|---|---|
| Holt's smoothing | 50% | A smoothed level and a smoothed trend (α = 0.35, β = 0.15). The trend is damped (φ = 0.88) so a decline flattens out instead of running to zero. |
| Linear regression | 30% | A straight line through the 8 weeks, carried forward at most 14 days. |
| Weighted moving average | 20% | The last 7 days, the most recent counting most (weights 1 to 7). |

Then:

- **Slow products** (under 1 a day on average): 85% of the figure is the plain average of the last 28 days and 15% is the mix above. For a product that sells now and then, trend methods mostly follow noise.
- **Floor:** the figure is never below 55% of the product's average over its last 14 days.
- **Day of the week:** with 14 days or more, each day is scaled by how that weekday has sold against the product's average. The effect is halved and kept between 0.3 and 2.

### 6.3 The model: 42 days or more on record

**Two learners, averaged.** Both are from scikit-learn 1.6.1 (Python 3).

| | Random Forest | Gradient Boosting |
|---|---|---|
| What it does | Averages many decision trees, each grown on a different sample of the data, so one unusual day does not swing the result | Adds small trees one after another, each correcting what the ones before got wrong |
| Trees | 60 | 80 |
| Depth | up to 8 | 2 |
| Smallest leaf | 20 product-days | 60 product-days |
| Other settings | √(number of inputs) tried at each split, bootstrap samples | learning rate 0.05, each tree sees 80% of the rows |
| Random seed | fixed (7) | fixed (11) |

> forecast for a day = (Random Forest + Gradient Boosting) ÷ 2, never below 0

The seeds are fixed, so the same sales give the same forecast every time.

**One model for the whole shop.** The two learners are fitted once on every product's history together, not once per product. A product here sells on a handful of days a month. Fitted alone, a tree would have a few dozen rows and would memorise the odd day something sold.

**The 12 inputs** (one row per product per day):

| Group | Input |
|---|---|
| The day being forecast | day of the week |
| | weekend or not |
| | day of the month |
| | month |
| | public holiday or not (14 fixed-date Philippine holidays; movable ones are not included) |
| The product's recent sales | sales on the last day on record |
| | sales 7 days before that |
| | sales 14 days before that |
| | sales 28 days before that |
| The product's level | average of the last 7 days |
| | average of the last 28 days |
| How far ahead | number of days between the last day on record and the day being forecast (1 to 30) |

There is no input that names the product. What tells the model how much a product sells is its own recent sales and averages.

**Each day is forecast directly.** A training row pairs what was known on one day with what sold some days later; the gap runs through 1 to 30 in turn. The model so learns to forecast any day ahead from the last real sales. Nothing it predicts is fed back in as if it had happened. (Feeding forecasts back in was measured to run about 35% high for products that sell on few days.)

**How much history, and how it is weighted.**

- The model reads the **last 120 days on record** of each product.
- **Recent days count for more:** a day's weight halves every 60 days going back.

Both were chosen by the test in section 10. Before, it read 365 days with every day counting the same. The shop's sales fell to about a quarter of their earlier level in June (97 to 136 items a day in March to May, 26 in June, 11 in October), and a model that treated both levels as equals read the present too high.

**The mix.** The code can mix the model with the simple trend:

> final = (1 − share) × simple trend + share × model

The share is now **1**: a product with 42 days or more is forecast by the model alone. It was 0.5. Section 10 says how 1 was chosen.

Code: `ml/forecast.py` (the model), `backend/utils/mlForecast.js` (the bridge from Node to Python), `simpleTrend()` and `TUNING` in `backend/routes/predictions.js`.

---

## 7. The range, the trend arrow and confidence

These are worked out from the product's last 8 weeks. They describe the product; they are not part of the forecast figure.

- **Range on the chart:** the forecast ± 1.28 × the spread (standard deviation) of the product's daily sales, never below 0. It is a rough band. It has not been tested as an 80% interval and should not be called one.
- **Trend:** "up" or "down" when the straight line through the 8 weeks rises or falls by more than 2% of the average per day; otherwise "stable".
- **Confidence:** a score out of 100, capped at 95:

| Part | Marks | From |
|---|---|---|
| How much there is to go on | up to 35 | days in the window ÷ 30 |
| How well a straight line fits | up to 30 | R² of the regression |
| How steady the sales are | up to 35 | less as the spread grows against the average. **Nothing when nothing sold in the window.** |

70 or more reads "high", 45 or more "medium", under 45 "low".

The last row is a fix. With no sales in 8 weeks the score used to give full marks for steadiness, so the only products marked "high" were the 14 that had stopped selling. **All 119 products now read "low"** (scores 35 to 39). That is the honest reading: no product sold on more than 13 of the last 56 days.

---

## 8. The last step: correcting for the last miss

Every method here reads a product's level from recent weeks. When sales are falling it runs high; when they are rising it runs low. In testing, the forecast was above what sold in every fortnight while sales fell fortnight after fortnight.

The system already tests itself each time it runs (section 9.1). That test says how far off the same method was, most recently, on days it had not seen. The live forecast is corrected by half of that:

> factor = 1 + 0.5 × (sold ÷ forecast − 1), kept between 0.6 and 1.4

If the method forecast 100 for the last fortnight and 80 sold, the next forecast is multiplied by 0.9.

- **Half, not all.** One fortnight's miss is partly chance, and correcting all of it makes the forecast swing.
- **By category.** Categories do not move together. A category that sold fewer than 20 items in the test fortnight takes the whole shop's factor. If the whole shop sold fewer than 20, nothing is adjusted.
- **Nothing looks ahead.** The factor for today's forecast comes only from days already past. When the accuracy test scores the last fortnight, that forecast carries the factor from the fortnight before it, as it would have at the time.

The page states the factors in use, after the accuracy table: "Today's forecast is then corrected by half of the miss in this test, category by category: Food ×…, …". In the four test fortnights they ranged from 0.725 (Food) to 1.097 (Health & Wellness).

Code: `backend/utils/forecastAdjust.js`.

---

## 9. How accuracy is measured

### 9.1 The test on the page

Each time the forecast is worked out:

1. The last 14 days on record are hidden (7 if a product has under 42 days).
2. Every product is forecast from the days before them.
3. The forecast total is compared with what sold.

> accuracy = 100 − |forecast − sold| ÷ sold × 100, never below 0

It is scored on the shop total, not product by product, and is withheld when fewer than 20 items sold in the hidden days. The page also shows the same score for Random Forest alone, Gradient Boosting alone, both together, and the simple trend.

**This is accuracy, not error.** 86% means the shop total was 14% off. It says nothing about how far off single products were: a forecast that is too high for half the products and too low for the other half scores 100%.

### 9.2 The error figures in this document

`scripts/forecast-backtest.js` runs the same test on any fortnights and prints error per product:

| Figure | Meaning |
|---|---|
| MAE | Average size of the miss, in items, per product per fortnight |
| RMSE | The same, but large misses count for more |
| MAPE | Average miss as a percentage of what sold. It can only be worked out where something sold, so the number of cases it rests on is given |
| WAPE | Total miss as a percentage of total sold |
| Bias | Forecast total against sold total. Above zero means the forecast ran high |

### 9.3 Results: four fortnights the forecast was not shown

120 products × 4 fortnights = 480 cases, 780 items sold.

**All four together, per product per fortnight**

| | MAE | RMSE | MAPE (311 cases) | WAPE | Bias | Forecast vs sold |
|---|---|---|---|---|---|---|
| Before the fixes | 1.549 | 1.917 | 73.8% | 95.3% | +36.4% | 1,064.3 vs 780 |
| **Now** | **1.402** | **1.741** | **59.9%** | **86.3%** | **+15.6%** | **901.4 vs 780** |
| Now, before the last step | 1.475 | 1.811 | 62.7% | 90.8% | +27.3% | 992.9 vs 780 |

**Each fortnight**

| Fortnight | Sold | Before: MAE / bias / page accuracy | Now: MAE / bias / page accuracy |
|---|---|---|---|
| 16 to 29 Aug | 235 | 1.727 / +36.5% / 63.5% | 1.567 / +30.0% / 70.0% |
| 30 Aug to 12 Sep | 210 | 1.676 / +42.7% / 57.3% | 1.572 / +21.3% / 78.7% |
| 13 to 26 Sep | 175 | 1.373 / +24.2% / 75.8% | 1.207 / −9.1% / 90.9% |
| 27 Sep to 10 Oct | 160 | 1.422 / +41.5% / 58.5% | 1.263 / +13.9% / 86.1% |

**Each product group**

| Group | Cases | Sold | Before: MAE / RMSE / bias | Now: MAE / RMSE / bias |
|---|---|---|---|---|
| Food | 244 | 278 | 1.317 / 1.588 / +67.9% | 1.227 / 1.456 / +37.2% |
| Health & Wellness | 152 | 331 | 1.856 / 2.325 / +18.8% | 1.586 / 2.051 / +2.9% |
| Accessories | 68 | 144 | 1.622 / 1.926 / +16.1% | 1.557 / 1.872 / +2.8% |
| Litter & Waste | 16 | 27 | 1.870 / 2.160 / +37.6% | 1.660 / 1.935 / +15.8% |

**Per product per day** (6,720 cases): MAE 0.246 → 0.226, RMSE 0.447 → 0.443. MAPE went from 85.4% to 87.8% (on the 538 product-days with a sale): on a day something sells, a forecast of a fraction of an item is always far off in percentage terms, which is why the fortnight total is what is scored.

**The parts, now**

| | MAE | RMSE | Bias |
|---|---|---|---|
| Simple trend alone | 1.582 | 2.188 | +24.9% |
| Model alone | 1.472 | 1.810 | +26.8% |
| Model + last step (what the page uses) | 1.402 | 1.741 | +15.6% |

Before the fixes the model alone was the worse of the two (MAE 1.633, bias +47.8%, against 1.580 and +24.8% for the simple trend). Reading 120 days with recent days counting for more, with the guards in front, is what changed that.

**Against rules of thumb, on the same 480 cases**

| | MAE | RMSE | Bias |
|---|---|---|---|
| The forecast now | 1.402 | 1.741 | +15.6% |
| "Average of the last 28 days" | 1.577 | 2.137 | +28.1% |
| "Same as the last 14 days" | 1.648 | 2.422 | +17.8% |
| "Average of the last 56 days" | 1.634 | 2.192 | +47.3% |
| "Forecast nothing" | 1.625 | 2.422 | −100% |

The forecast is 11% better than the best rule on the average miss and 19% better on large misses. Before the fixes it was 2% and 10% better.

The last row matters. Forecasting nothing at all has an average miss of 1.625, because a product here sells one or two items a fortnight. **No method can have a small error per product on sales this thin.** The forecast earns its keep on totals: by category, and for the shop.

---

## 10. How the settings were chosen

The brief was: re-tune using held-out fortnights only, with no leakage. This is what was done. `scripts/forecast-tune.js` repeats it.

**Candidates: 1,620**, every combination of

| What | Choices |
|---|---|
| The model's memory | days' weight halves every (never, 30, 60) days × reads (365, 120) days |
| The simple trend | floor (0.55, 0.3, 0) × slow-product window (28, 14) days |
| The model's share of the mix | 0, 0.25, 0.5, 0.75, 1 |
| The last step | none; a correction for the shop's recent trend (4 strengths); a correction for the forecast's own last miss, for the whole shop (half, all) or by category (half, all) |

**Windows.** Each candidate was scored on weekly test windows of 14 days. Windows count from 4 July 2026, once sales had settled after the break in May.

**The rule, fixed before any result was looked at:**

1. keep the candidates whose forecast total is within 10% of what sold
2. among those, take the smallest error per product per fortnight (RMSE)

**Walk-forward.** For each test fortnight, the settings were chosen using only windows that had already ended when that fortnight's forecast would have been made. So the result for a fortnight is for settings that could not have been fitted to it.

| Test fortnight | Windows to choose from | Chosen | Old settings: MAE / bias | Chosen: MAE / bias |
|---|---|---|---|---|
| 16 to 29 Aug | 5 | fade 60, read 365, share 1, no last step | 1.788 / +41.4% | 1.763 / +42.9% |
| 30 Aug to 12 Sep | 7 | fade 60, read 365, share 1, miss by category ½ | 1.601 / +33.4% | 1.561 / +15.8% |
| 13 to 26 Sep | 9 | fade 60, read 120, share 0.75, miss by category ½ | 1.417 / +30.2% | 1.214 / −5.2% |
| 27 Sep to 10 Oct | 11 | fade 60, read 120, share 1, miss by category ½ | 1.325 / +26.5% | 1.262 / +13.9% |
| **All four** | | | **1.533 / +33.7%** | **1.450 / +18.9%** |

By group, chosen walk-forward: Food MAE 1.307, bias +46.6%; Health & Wellness 1.588, +2.0%; Accessories 1.596, +3.5%; Litter & Waste 1.695, +21.4%.

("Old settings" here means the old settings with the new guards in front. The "before the fixes" row in section 9 is the code before any change.)

**What the code is set to.** The same rule applied to all 13 windows on record picks: weight halves every **60** days, reads **120** days, trend floor **0.55**, slow window **28**, model share **1**, last step **the forecast's own last miss, by category, half**. On those 13 windows: MAE 1.660, RMSE 2.347, bias +8.7% (old settings: 1.787, 2.491, +20.3%).

**Which figure to quote.**

- **+18.9% bias, MAE 1.450** is the held-out result: settings chosen without sight of the fortnight they were scored on. Quote this one as the tested result.
- **+15.6% bias, MAE 1.402** is the code as it stands on the same four fortnights. The final settings were chosen from windows that include those fortnights, so this figure is slightly flattering.

**What the test found about the old blend.** Neither half of the half-and-half blend was the cause of the bias. Sales fell every fortnight from mid-July (362, 335, 299, 235, 210, 175, 160) and both halves read the level from recent weeks, so both ran high. The model had the smaller error per product in every period tested, and each step toward it helped.

---

## 11. Limits

State these wherever the forecast is presented.

**1. Per product, the error is as large as the sales.** See the end of section 9.3. Use the forecast for categories and the shop total; treat a single product's figure as a rough guide.

**2. It still runs high.** +18.9% on held-out fortnights. Food is the worst group (+37% to +47%); Health & Wellness and Accessories are within 4%.

**3. The settings were chosen in a period when sales only fell.** All 13 tuning windows are from July to October 2026, when sales fell every fortnight. Settings that lean low suit such a period. They have not been tested in a period of rising sales, because the shop has none on record. Re-run `scripts/forecast-tune.js` when a few more months exist.

**4. A lasting rise is recognised slowly.** Made-up products, each added alone to the 120 real ones:

| Made-up history | If the new level held, 30 days | Forecast |
|---|---|---|
| 1 sale every 5th day, then 1 a day for 20 days | 30 | 6.2 |
| … for 42 days | 30 | 14.5 |
| … for 56 days | 30 | 20.0 |
| … for 84 days | 30 | 25.1 |
| 2 a day, then 10 a day for 14 days | 300 | 100.4 (was 207.3 before the fixes) |

The model has learned from this shop that a burst of sales usually fades. For real products that is right: a rule that followed every sharp rise was tested on the held-out fortnights and made the forecast worse (45 forecast against 12 sold where it acted). But a product whose sales really have risen for good will be under-forecast for some weeks, and too little would be ordered. **Check fast-rising products by eye.**

**5. A fall is followed sooner, and can undershoot.**

| Made-up history | If the new level held | Forecast |
|---|---|---|
| 10 a day, then 2 a day for 20 days | 60 | 30.4 (was 31.6) |
| 10 a day, then nothing for 20 days | 0 | 4.9 (was 2.3) |
| 20 a day falling to 1 over 60 days | 30 or less | 73.3 (was 43.5) |
| 20 a day falling to 0 over 20 days, only 20 days on record | 0 | 113.4 (unchanged: simple trend, with its floor) |

The last row is the QA report's finding L4, and it is **not fixed**. The row above it has become worse. A rule for "a clear drop in level" was tried: on the four held-out fortnights it never acted on a single real product, so it could be neither tested nor tuned on this shop's data, and it carries a risk of its own (see 7). It was not added.

**6. A product far above the shop's usual sales is read low.** The busiest real product sells about 0.34 a day (19 in 8 weeks). A made-up product selling exactly 1 a day for 120 days is forecast 25.5 for 30 days, not 30; one selling 3 a day is forecast 87.9, not 90. Such a product also carries more weight in what the one shared model learns: adding the steady 3-a-day product moved the other products' total by +6.5%.

**7. An empty shelf looks like no demand.** The system reads sales, not demand. A product that was out of stock for two weeks sold nothing in them, and the forecast reads that as a product that sells less. The stock history needed to tell the two apart is not in the data (59 stock movements for 4,473 sale lines).

**8. Seasons, moving holidays, promotions.** 225 days of sales cannot show a yearly season. Month is one of the model's inputs, but it has seen each month once at most. Holy Week, Eid, promotions, price changes and supplier shortages are not things it is told. The page says this under "What the forecast cannot know".

**9. The sales history itself.** The QA report found that the sales on record did not go through the till (4,473 sale lines have 59 stock movements behind them), and their level falls to about a quarter in June, after the 22 days without data. Say in the paper how the history was made: every figure here describes how the method does on this history, not on a year of real trading.

**10. Fixed assumptions in stock planning.** Delivery takes 7 days for every supplier. Safety stock assumes a 95% service level. Neither is learned from data.

---

## 12. What to change in the paper, slides and test plan

| Where it may say | What matches the system |
|---|---|
| "Linear regression" as the forecasting method (the test plan says this) | Random Forest and Gradient Boosting (scikit-learn), one fit for all products, averaged. Linear regression is 30% of the simple trend, which is used only for products with 14 to 41 days on record or when Python is unavailable. |
| "The ensemble is blended half and half with a statistical baseline" | The ensemble alone, for a product with 42 days or more. The mix share is 1 (was 0.5). |
| "Trained on up to twelve months" | Reads up to 12 months to build each product's history; the model learns from the last 120 days on record, recent days counting for more (weight halves every 60 days). Both are within the 3 to 12 months the study specifies. |
| Accuracy figures such as 35.2%, 58.5%, 82.2% | Those were page accuracy for one fortnight before the fixes. Now, for 27 Sep to 10 Oct: 86.1% (182.2 forecast, 160 sold). Over four held-out fortnights: bias +18.9%, MAE 1.450, RMSE 1.799. |
| "Accuracy" and "error" used as the same thing | Page accuracy is about the shop total. Error (MAE, RMSE, MAPE) is per product. Give both and say which is which (section 9). |
| No mention of data cleaning | Three guards: days without data left out (10 to 31 May 2026), freak days capped, new products given a cautious estimate (sections 4 to 6.1). |
| No mention of the correction step | Section 8. |
| Features | The 12 inputs in section 6.3. |
| "High / medium / low confidence" | All products currently read "low" (section 7). |
| Limitations | Section 11. |

Test plan cases to add or reword, by their numbers in `QA/QA-TEST-REPORT.md`: the method named (B02), bias (B04), the model against the simple trend (B06), a new product (B08), a spike (B11), a sudden drop or rise (B12), one freak value staying with its own product (B15), limits stated on the page (B18), confidence (B22), sales with no items (C04) and revenue by category adding up (A34).

---

## 13. From forecast to stock decisions

All in `planStock()` in `backend/routes/predictions.js`. "Daily" is the 30-day forecast ÷ 30.

| Figure | How it is worked out |
|---|---|
| Stock lasts | stock ÷ daily, rounded down |
| Runs out on | today + that many days |
| Out | stock is 0 |
| Reorder now | stock at or below the reorder level, or lasts 7 days or less (the delivery time) |
| Reorder soon | lasts 21 days or less |
| Order by | today if at or below the reorder level; otherwise the run-out date less 7 days |
| Suggested order | the larger of (30-day forecast + 7 days' sales − stock) and (2 × reorder level − stock), less what a supplier is already bringing. Nothing when stock is fine. |
| Safety stock | 1.65 × the spread of daily sales × √7, rounded up (about a 95% service level) |
| Reorder point | 7 days' expected sales, rounded up, + safety stock |
| Too much stock | what is left after 90 days of expected sales; for a product with stock, no forecast and no sale in 30 days, everything above its reorder level |
| Likely to expire | stock less what is expected to sell before the expiry date, for dates within 180 days |
| Selling fast / slowly | top and bottom quarter of products expected to sell at least 0.5 in 30 days |
| Not selling | under 0.5 expected and nothing sold in the last 30 days |

---

## 14. How to check any of this yourself

Both scripts read the database and write nothing to it.

```bash
node scripts/forecast-backtest.js 2026-10-10 2026-09-26 2026-09-12 2026-08-29
```

Scores the forecast as the code stands on the fortnights ending on those days: MAE, RMSE, MAPE, WAPE and bias, for the page's figure, the model alone and the simple trend alone, by category and per day. With no dates it takes the last four fortnights. Add `--json file.json` to save every product's figures.

```bash
node scripts/forecast-tune.js
```

Repeats the walk-forward test in section 10. A first run fits the model about 90 times and takes ten minutes or so.

```bash
cd backend && npm test
```

184 automated tests, among them the cap, the new-product estimate, days without data, the correction factors and confidence.

| File | What is in it |
|---|---|
| `ml/forecast.py` | The model: inputs, training rows, Random Forest, Gradient Boosting |
| `backend/utils/mlForecast.js` | Runs the Python model once for all products; the 120 days and the 60-day half-life |
| `backend/utils/forecastGuards.js` | Days without data, the cap, the new-product rule |
| `backend/utils/forecastAdjust.js` | The correction for the last miss |
| `backend/routes/predictions.js` | The steps in order, the simple trend, the mix, the accuracy test, stock planning |
| `src/js/analytics.js`, `src/reports.html` | What the Stock planning page shows and says |
| `scripts/forecast-backtest.js`, `scripts/forecast-tune.js` | The two checks above |
