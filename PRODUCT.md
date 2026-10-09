# Product

<!-- impeccable:product-schema 1 -->

Source: the thesis paper and the repository. Nothing here was asked in a separate interview; correct anything that is wrong.

## Platform

web

## Users

- **The owner / administrator of Risha Pet Supplies**, a single neighbourhood pet supply shop in the Philippines. Checks stock, expiry dates, sales and what to reorder, usually on a laptop at the shop or at home after closing.
- **Manager and viewer** accounts: the same back office with fewer rights.
- **Staff at the counter (cashier role)**: sells all day on one screen, cash only, with customers waiting. Opens the till with a float, counts it at closing.
- **Suppliers**: sign in occasionally to confirm orders, set delivery dates and prices, and see what the shop is likely to need.
- **The thesis panel** (De La Salle Araneta University), who judge whether it looks and works like a real system.

## Product Purpose

FETCH is the shop's inventory system with sales forecasting. It records every sale and delivery, warns before products run out or expire, and tells the owner what to order and by when. Success: the owner trusts the numbers enough to order from them, and the counter is never slowed down.

## Positioning

The forecast is made from this shop's own sales history (Random Forest and Gradient Boosting blended with a simple trend) and is turned into plain instructions: order this many, by this date. It shows its own measured accuracy.

## Operating Context

One shop, one till, cash only, Philippine pesos, Manila time. Products are pet food, treats, grooming, medicine and accessories; many carry expiry dates. Stock arrives by purchase order from a handful of suppliers. Printed receipts and end-of-day counts are part of the routine.

## Capabilities and Constraints

- Pages: dashboard, inventory, point of sale, sales history, suppliers and purchase orders, analytics, reports (including void requests), notifications, users, audit log, settings, supplier portal.
- Roles: admin, manager, viewer, cashier (shown as "Staff"), supplier.
- Vanilla HTML/CSS/JS frontend, Node/Express backend, MySQL, a Python scikit-learn model. No build step.
- Light and dark mode, an accent colour and font choice in Settings.
- Must work on a laptop and a phone.

## Brand Commitments

- Shop name: Risha Pet Supplies. System name: FETCH.
- Logo at `src/images/logo.jpeg`: a red rounded "R" with a paw print on sky blue, ringed in red, on a yellow ground patterned with paws and bones. Chunky, rounded, friendly.
- The user has rejected three looks: a coral/gradient/animated one ("looks AI generated"), a flat grey one ("too simple, buttons need hover to be recognised") and a navy-sidebar/blue-button/soft-card one ("AI slop").
- Every control must look like a control without hovering.

## Evidence on Hand

Real products, sales (about a year), suppliers and purchase orders in the database. Measured forecast accuracy shown in Analytics. No product photography for most items; the Brand field is empty.

## Product Principles

1. Say what to do, not just what happened.
2. The counter comes first: nothing may slow a sale.
3. Honest numbers, including the model's own accuracy.
4. One shop's tool, not a generic dashboard.
