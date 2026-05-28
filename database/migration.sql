USE risha_pet_supplies;

-- 1. Update categories from species names to real product categories
UPDATE categories SET name = 'Food', description = 'Pet food, treats, and dietary products for all species' WHERE name = 'Dogs';
UPDATE categories SET name = 'Litter & Waste', description = 'Cat litter, poop bags, and waste management' WHERE name = 'Cats';
UPDATE categories SET name = 'Cages & Habitats', description = 'Cages, aquariums, and housing for pets' WHERE name = 'Birds';
UPDATE categories SET name = 'Toys', description = 'Pet toys, play gyms, and enrichment items' WHERE name = 'Fish';

-- Update the remaining categories
UPDATE categories SET description = 'Collars, leashes, beds, bowls, and general accessories' WHERE name = 'Accessories';
UPDATE categories SET description = 'Pet food and treats for all species' WHERE name = 'Food' AND description NOT LIKE 'Pet food%';

-- 2. Add unit_type column to products
ALTER TABLE products ADD COLUMN unit_type ENUM('piece','kg','g','liter','ml') DEFAULT 'piece' AFTER max_stock_level;

-- 3. Change stock_quantity to DECIMAL for weight-based products
ALTER TABLE products MODIFY COLUMN stock_quantity DECIMAL(10,3) DEFAULT 0;

-- 4. Change sale_items.quantity to DECIMAL
ALTER TABLE sale_items MODIFY COLUMN quantity DECIMAL(10,3) NOT NULL;

-- 5. Change stock_movements.quantity to DECIMAL
ALTER TABLE stock_movements MODIFY COLUMN quantity DECIMAL(10,3) NOT NULL;
