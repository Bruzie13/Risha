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

-- 6. Add user_id and related_id/related_type to notifications for user-targeted + polymorphic notifications
ALTER TABLE notifications ADD COLUMN user_id INT DEFAULT NULL AFTER is_read;
ALTER TABLE notifications ADD COLUMN related_id INT DEFAULT NULL AFTER user_id;
ALTER TABLE notifications ADD COLUMN related_type VARCHAR(50) DEFAULT NULL AFTER related_id;
ALTER TABLE notifications ADD INDEX idx_user (user_id);
ALTER TABLE notifications ADD INDEX idx_related (related_type, related_id);
