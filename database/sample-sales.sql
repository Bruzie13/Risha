USE risha_pet_supplies;

-- Clear existing sales data
DELETE FROM stock_movements WHERE reference_type = 'sale';
DELETE FROM sale_items;
DELETE FROM sales;

-- Reset auto-increment
ALTER TABLE sales AUTO_INCREMENT = 1;

-- Insert sample sales
INSERT INTO sales (sale_number, customer_name, customer_phone, total_amount, final_amount, discount, payment_method, payment_status, notes, created_by, created_at, updated_at) VALUES
('SALE-202605-0001', 'Gloria Hernandez', NULL, 550, 550.0, 0.0, 'cash', 'completed', NULL, 3, '2026-04-12 01:50:56', '2026-04-12 01:50:56'),
('SALE-202605-0002', 'Juan Dela Cruz', NULL, 585, 585.0, 0.0, 'card', 'completed', NULL, 2, '2026-04-12 02:18:56', '2026-04-12 02:18:56'),
('SALE-202605-0003', 'Dennis Ramos', NULL, 1620, 1620.0, 0.0, 'card', 'completed', NULL, 1, '2026-04-12 08:55:56', '2026-04-12 08:55:56'),
('SALE-202605-0004', 'Angela Fernandez', NULL, 788, 788.0, 0.0, 'cash', 'completed', NULL, 3, '2026-04-13 10:51:56', '2026-04-13 10:51:56'),
('SALE-202605-0005', 'Cecilia Navarro', NULL, 310, 310.0, 0.0, 'card', 'completed', NULL, 1, '2026-04-13 05:37:56', '2026-04-13 05:37:56'),
('SALE-202605-0006', 'Miguel Lopez', NULL, 4720, 4484.0, 236.0, 'card', 'completed', NULL, 1, '2026-04-13 05:23:56', '2026-04-13 05:23:56'),
('SALE-202605-0007', 'Lisa Mercado', NULL, 5960, 5960.0, 0.0, 'card', 'completed', NULL, 2, '2026-04-14 01:53:56', '2026-04-14 01:53:56'),
('SALE-202605-0008', 'Marites Tan', NULL, 5380, 5380.0, 0.0, 'online', 'completed', NULL, 2, '2026-04-14 10:20:56', '2026-04-14 10:20:56'),
('SALE-202605-0009', 'Miguel Lopez', NULL, 4236, 4236.0, 0.0, 'cash', 'completed', NULL, 2, '2026-04-15 05:10:56', '2026-04-15 05:10:56'),
('SALE-202605-0010', 'Isabella Cruz', NULL, 80, 80.0, 0.0, 'cash', 'completed', NULL, 2, '2026-04-15 13:06:56', '2026-04-15 13:06:56'),
('SALE-202605-0011', 'Marites Tan', NULL, 6440, 6440.0, 0.0, 'cash', 'completed', NULL, 3, '2026-04-15 02:04:56', '2026-04-15 02:04:56'),
('SALE-202605-0012', 'Lorna Santiago', NULL, 2260, 2260.0, 0.0, 'card', 'completed', NULL, 1, '2026-04-16 12:01:56', '2026-04-16 12:01:56'),
('SALE-202605-0013', 'Marites Tan', NULL, 1890, 1890.0, 0.0, 'cash', 'completed', NULL, 2, '2026-04-17 12:58:56', '2026-04-17 12:58:56'),
('SALE-202605-0014', 'Teresa Aquino', NULL, 575, 575.0, 0.0, 'card', 'completed', NULL, 2, '2026-04-17 02:18:56', '2026-04-17 02:18:56'),
('SALE-202605-0015', 'Cecilia Navarro', NULL, 9890, 9890.0, 0.0, 'cash', 'completed', NULL, 3, '2026-04-18 07:08:56', '2026-04-18 07:08:56'),
('SALE-202605-0016', 'Antonio Rivera', NULL, 810, 810.0, 0.0, 'card', 'completed', NULL, 1, '2026-04-19 02:18:56', '2026-04-19 02:18:56'),
('SALE-202605-0017', 'Patricia Martinez', NULL, 1560, 1560.0, 0.0, 'cash', 'completed', NULL, 1, '2026-04-20 02:56:56', '2026-04-20 02:56:56'),
('SALE-202605-0018', 'Roberto Ortiz', NULL, 1935, 1935.0, 0.0, 'cash', 'completed', NULL, 3, '2026-04-20 04:44:56', '2026-04-20 04:44:56'),
('SALE-202605-0019', 'Rafael Morales', NULL, 6080, 6080.0, 0.0, 'online', 'completed', NULL, 2, '2026-04-20 02:35:56', '2026-04-20 02:35:56'),
('SALE-202605-0020', 'Dennis Ramos', NULL, 3535, 3535.0, 0.0, 'cash', 'completed', NULL, 3, '2026-04-21 06:41:56', '2026-04-21 06:41:56'),
('SALE-202605-0021', 'Dennis Ramos', NULL, 3050, 3050.0, 0.0, 'cash', 'completed', NULL, 1, '2026-04-21 12:34:56', '2026-04-21 12:34:56'),
('SALE-202605-0022', 'Lorna Santiago', NULL, 3010, 3010.0, 0.0, 'card', 'completed', NULL, 3, '2026-04-21 05:20:56', '2026-04-21 05:20:56'),
('SALE-202605-0023', 'Gloria Hernandez', NULL, 5640, 5640.0, 0.0, 'cash', 'completed', NULL, 1, '2026-04-22 06:03:56', '2026-04-22 06:03:56'),
('SALE-202605-0024', 'Teresa Aquino', NULL, 4740, 4740.0, 0.0, 'cash', 'completed', NULL, 1, '2026-04-22 08:13:56', '2026-04-22 08:13:56'),
('SALE-202605-0025', 'Carlos Villanueva', NULL, 7468, 7468.0, 0.0, 'online', 'completed', NULL, 3, '2026-04-23 04:37:56', '2026-04-23 04:37:56'),
('SALE-202605-0026', 'Marites Tan', NULL, 2555, 2555.0, 0.0, 'online', 'completed', NULL, 2, '2026-04-23 05:50:56', '2026-04-23 05:50:56'),
('SALE-202605-0027', 'Rafael Morales', NULL, 4990, 4990.0, 0.0, 'card', 'completed', NULL, 1, '2026-04-23 06:20:56', '2026-04-23 06:20:56'),
('SALE-202605-0028', 'Pedro Reyes', NULL, 6880, 6880.0, 0.0, 'cash', 'completed', NULL, 2, '2026-04-24 10:17:56', '2026-04-24 10:17:56'),
('SALE-202605-0029', 'Teresa Aquino', NULL, 12870, 12870.0, 0.0, 'cash', 'completed', NULL, 2, '2026-04-24 09:51:56', '2026-04-24 09:51:56'),
('SALE-202605-0030', 'Antonio Rivera', NULL, 565, 536.75, 28.25, 'cash', 'completed', NULL, 1, '2026-04-25 10:09:56', '2026-04-25 10:09:56'),
('SALE-202605-0031', 'Isabella Cruz', NULL, 8480, 8056.0, 424.0, 'cash', 'completed', NULL, 1, '2026-04-26 07:58:56', '2026-04-26 07:58:56'),
('SALE-202605-0032', 'Roberto Ortiz', NULL, 160, 144.0, 16.0, 'cash', 'completed', NULL, 1, '2026-04-26 04:03:56', '2026-04-26 04:03:56'),
('SALE-202605-0033', 'Roberto Ortiz', NULL, 14340, 13623.0, 717.0, 'online', 'completed', NULL, 2, '2026-04-26 11:34:56', '2026-04-26 11:34:56'),
('SALE-202605-0034', 'Cecilia Navarro', NULL, 5850, 5850.0, 0.0, 'online', 'completed', NULL, 3, '2026-04-27 08:14:56', '2026-04-27 08:14:56'),
('SALE-202605-0035', 'Dennis Ramos', NULL, 2500, 2500.0, 0.0, 'online', 'completed', NULL, 3, '2026-04-27 09:05:56', '2026-04-27 09:05:56'),
('SALE-202605-0036', 'Rowena Castillo', NULL, 285, 285.0, 0.0, 'cash', 'completed', NULL, 1, '2026-04-27 13:10:56', '2026-04-27 13:10:56'),
('SALE-202605-0037', 'Francisco Diaz', NULL, 1040, 1040.0, 0.0, 'online', 'completed', NULL, 3, '2026-04-28 02:33:56', '2026-04-28 02:33:56'),
('SALE-202605-0038', 'Patricia Martinez', NULL, 1183, 1123.85, 59.15, 'online', 'completed', NULL, 2, '2026-04-28 08:35:56', '2026-04-28 08:35:56'),
('SALE-202605-0039', 'Rowena Castillo', NULL, 2187, 2187.0, 0.0, 'card', 'completed', NULL, 2, '2026-04-29 10:02:56', '2026-04-29 10:02:56'),
('SALE-202605-0040', 'Jose Garcia', NULL, 4465, 4465.0, 0.0, 'cash', 'completed', NULL, 2, '2026-04-29 09:44:56', '2026-04-29 09:44:56'),
('SALE-202605-0041', 'Gregorio Alvarez', NULL, 5200, 5200.0, 0.0, 'online', 'completed', NULL, 1, '2026-04-29 10:43:56', '2026-04-29 10:43:56'),
('SALE-202605-0042', 'Carlos Villanueva', NULL, 3720, 3720.0, 0.0, 'card', 'completed', NULL, 3, '2026-04-30 04:47:56', '2026-04-30 04:47:56'),
('SALE-202605-0043', 'Cecilia Navarro', NULL, 3180, 2862.0, 318.0, 'cash', 'completed', NULL, 1, '2026-05-01 06:50:56', '2026-05-01 06:50:56'),
('SALE-202605-0044', 'Eduardo Jimenez', NULL, 170, 153.0, 17.0, 'online', 'completed', NULL, 2, '2026-05-02 06:05:56', '2026-05-02 06:05:56'),
('SALE-202605-0045', 'Patricia Martinez', NULL, 1600, 1600.0, 0.0, 'cash', 'completed', NULL, 3, '2026-05-02 11:00:56', '2026-05-02 11:00:56'),
('SALE-202605-0046', 'Ana Gonzales', NULL, 2320, 2088.0, 232.0, 'card', 'completed', NULL, 3, '2026-05-03 05:26:56', '2026-05-03 05:26:56'),
('SALE-202605-0047', 'Angela Fernandez', NULL, 6065, 5761.75, 303.25, 'card', 'completed', NULL, 1, '2026-05-03 10:46:56', '2026-05-03 10:46:56'),
('SALE-202605-0048', 'Gloria Hernandez', NULL, 290, 290.0, 0.0, 'cash', 'completed', NULL, 3, '2026-05-04 07:03:56', '2026-05-04 07:03:56'),
('SALE-202605-0049', 'Lisa Mercado', NULL, 2281, 2281.0, 0.0, 'card', 'completed', NULL, 3, '2026-05-05 11:16:56', '2026-05-05 11:16:56'),
('SALE-202605-0050', 'Cecilia Navarro', NULL, 660, 660.0, 0.0, 'online', 'completed', NULL, 3, '2026-05-06 12:43:56', '2026-05-06 12:43:56'),
('SALE-202605-0051', 'Sofia Ramirez', NULL, 280, 280.0, 0.0, 'online', 'completed', NULL, 2, '2026-05-06 12:03:56', '2026-05-06 12:03:56'),
('SALE-202605-0052', 'Gloria Hernandez', NULL, 4840, 4840.0, 0.0, 'card', 'completed', NULL, 2, '2026-05-06 06:38:56', '2026-05-06 06:38:56'),
('SALE-202605-0053', 'Eduardo Jimenez', NULL, 9870, 9870.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-07 02:42:56', '2026-05-07 02:42:56'),
('SALE-202605-0054', 'Henry Valdez', NULL, 8160, 8160.0, 0.0, 'online', 'completed', NULL, 1, '2026-05-07 03:04:56', '2026-05-07 03:04:56'),
('SALE-202605-0055', 'Ferdinand Gomez', NULL, 6160, 6160.0, 0.0, 'online', 'completed', NULL, 2, '2026-05-08 06:03:56', '2026-05-08 06:03:56'),
('SALE-202605-0056', 'Roberto Ortiz', NULL, 3120, 2808.0, 312.0, 'cash', 'completed', NULL, 2, '2026-05-08 12:40:56', '2026-05-08 12:40:56'),
('SALE-202605-0057', 'Gregorio Alvarez', NULL, 3300, 3300.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-09 03:57:56', '2026-05-09 03:57:56'),
('SALE-202605-0058', 'Francisco Diaz', NULL, 582, 523.8, 58.2, 'online', 'completed', NULL, 2, '2026-05-09 03:03:56', '2026-05-09 03:03:56'),
('SALE-202605-0059', 'Francisco Diaz', NULL, 2190, 2190.0, 0.0, 'cash', 'completed', NULL, 2, '2026-05-09 02:20:56', '2026-05-09 02:20:56'),
('SALE-202605-0060', 'Sofia Ramirez', NULL, 320, 320.0, 0.0, 'cash', 'completed', NULL, 3, '2026-05-10 10:30:56', '2026-05-10 10:30:56'),
('SALE-202605-0061', 'Cecilia Navarro', NULL, 559, 559.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-10 05:00:56', '2026-05-10 05:00:56'),
('SALE-202605-0062', 'Maria Santos', NULL, 360, 360.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-11 08:48:56', '2026-05-11 08:48:56'),
('SALE-202605-0063', 'Miguel Lopez', NULL, 887, 887.0, 0.0, 'online', 'completed', NULL, 2, '2026-05-11 06:48:56', '2026-05-11 06:48:56'),
('SALE-202605-0064', 'Cecilia Navarro', NULL, 5686, 5686.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-12 05:58:56', '2026-05-12 05:58:56'),
('SALE-202605-0065', 'Sofia Ramirez', NULL, 5235, 5235.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-12 09:37:56', '2026-05-12 09:37:56'),
('SALE-202605-0066', 'Eduardo Jimenez', NULL, 5000, 5000.0, 0.0, 'card', 'completed', NULL, 1, '2026-05-12 11:00:56', '2026-05-12 11:00:56'),
('SALE-202605-0067', 'Juan Dela Cruz', NULL, 3110, 3110.0, 0.0, 'online', 'completed', NULL, 3, '2026-05-13 06:23:56', '2026-05-13 06:23:56'),
('SALE-202605-0068', 'Lisa Mercado', NULL, 5159, 5159.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-13 12:13:56', '2026-05-13 12:13:56'),
('SALE-202605-0069', 'Marites Tan', NULL, 3150, 3150.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-13 02:52:56', '2026-05-13 02:52:56'),
('SALE-202605-0070', 'Henry Valdez', NULL, 4330, 4330.0, 0.0, 'online', 'completed', NULL, 2, '2026-05-14 09:49:56', '2026-05-14 09:49:56'),
('SALE-202605-0071', 'Lorna Santiago', NULL, 9440, 9440.0, 0.0, 'card', 'completed', NULL, 1, '2026-05-15 04:37:56', '2026-05-15 04:37:56'),
('SALE-202605-0072', 'Juan Dela Cruz', NULL, 3300, 3300.0, 0.0, 'cash', 'completed', NULL, 2, '2026-05-16 02:24:56', '2026-05-16 02:24:56'),
('SALE-202605-0073', 'Dennis Ramos', NULL, 1760, 1760.0, 0.0, 'card', 'completed', NULL, 2, '2026-05-16 03:29:56', '2026-05-16 03:29:56'),
('SALE-202605-0074', 'Roberto Ortiz', NULL, 1100, 1100.0, 0.0, 'cash', 'completed', NULL, 1, '2026-05-16 11:57:56', '2026-05-16 11:57:56'),
('SALE-202605-0075', 'Ferdinand Gomez', NULL, 4920, 4920.0, 0.0, 'card', 'completed', NULL, 2, '2026-05-17 03:37:56', '2026-05-17 03:37:56'),
('SALE-202605-0076', 'Patricia Martinez', NULL, 6962, 6962.0, 0.0, 'online', 'completed', NULL, 3, '2026-05-17 11:19:56', '2026-05-17 11:19:56'),
('SALE-202605-0077', 'Carlos Villanueva', NULL, 3360, 3360.0, 0.0, 'card', 'completed', NULL, 1, '2026-05-17 04:13:56', '2026-05-17 04:13:56'),
('SALE-202605-0078', 'Jose Garcia', NULL, 7790, 7400.5, 389.5, 'card', 'completed', NULL, 1, '2026-05-18 09:20:56', '2026-05-18 09:20:56'),
('SALE-202605-0079', 'Carmen Torres', NULL, 3060, 2754.0, 306.0, 'online', 'completed', NULL, 2, '2026-05-18 13:21:56', '2026-05-18 13:21:56'),
('SALE-202605-0080', 'Jose Garcia', NULL, 1756, 1756.0, 0.0, 'card', 'completed', NULL, 3, '2026-05-19 07:26:56', '2026-05-19 07:26:56'),
('SALE-202605-0081', 'Gregorio Alvarez', NULL, 6715, 6715.0, 0.0, 'online', 'completed', NULL, 1, '2026-05-20 05:35:56', '2026-05-20 05:35:56'),
('SALE-202605-0082', 'Lisa Mercado', NULL, 475, 475.0, 0.0, 'card', 'completed', NULL, 2, '2026-05-20 09:04:56', '2026-05-20 09:04:56'),
('SALE-202605-0083', 'Dennis Ramos', NULL, 4175, 4175.0, 0.0, 'cash', 'completed', NULL, 3, '2026-05-20 05:44:56', '2026-05-20 05:44:56'),
('SALE-202605-0084', 'Ferdinand Gomez', NULL, 3184, 3184.0, 0.0, 'online', 'completed', NULL, 3, '2026-05-21 10:14:56', '2026-05-21 10:14:56'),
('SALE-202605-0085', 'Antonio Rivera', NULL, 3015, 3015.0, 0.0, 'cash', 'completed', NULL, 2, '2026-05-21 02:37:56', '2026-05-21 02:37:56'),
('SALE-202605-0086', 'Henry Valdez', NULL, 120, 120.0, 0.0, 'cash', 'completed', NULL, 3, '2026-05-22 12:45:56', '2026-05-22 12:45:56'),
('SALE-202605-0087', 'Carmen Torres', NULL, 3550, 3550.0, 0.0, 'online', 'completed', NULL, 2, '2026-05-22 05:36:56', '2026-05-22 05:36:56'),
('SALE-202605-0088', 'Francisco Diaz', NULL, 5190, 5190.0, 0.0, 'card', 'completed', NULL, 1, '2026-05-22 06:09:56', '2026-05-22 06:09:56'),
('SALE-202605-0089', 'Patricia Martinez', NULL, 11040, 11040.0, 0.0, 'cash', 'completed', NULL, 2, '2026-05-23 08:34:56', '2026-05-23 08:34:56'),
('SALE-202605-0090', 'Dennis Ramos', NULL, 10540, 10540.0, 0.0, 'cash', 'completed', NULL, 3, '2026-05-23 03:01:56', '2026-05-23 03:01:56'),
('SALE-202605-0091', 'Carlos Villanueva', NULL, 1250, 1250.0, 0.0, 'card', 'completed', NULL, 3, '2026-05-24 07:19:56', '2026-05-24 07:19:56'),
('SALE-202605-0092', 'Cecilia Navarro', NULL, 1259, 1196.05, 62.95, 'card', 'completed', NULL, 3, '2026-05-24 11:34:56', '2026-05-24 11:34:56'),
('SALE-202605-0093', 'Jose Garcia', NULL, 2420, 2420.0, 0.0, 'cash', 'completed', NULL, 2, '2026-05-24 10:12:56', '2026-05-24 10:12:56'),
('SALE-202605-0094', 'Miguel Lopez', NULL, 2956, 2660.4, 295.6, 'cash', 'completed', NULL, 1, '2026-05-25 02:58:56', '2026-05-25 02:58:56'),
('SALE-202605-0095', 'Marites Tan', NULL, 5900, 5605.0, 295.0, 'card', 'completed', NULL, 1, '2026-05-25 02:07:56', '2026-05-25 02:07:56'),
('SALE-202605-0096', 'Angela Fernandez', NULL, 1000, 950.0, 50.0, 'online', 'completed', NULL, 3, '2026-05-25 09:10:56', '2026-05-25 09:10:56'),
('SALE-202605-0097', 'Henry Valdez', NULL, 2350, 2232.5, 117.5, 'cash', 'completed', NULL, 1, '2026-05-26 11:02:56', '2026-05-26 11:02:56'),
('SALE-202605-0098', 'Isabella Cruz', NULL, 456, 410.4, 45.6, 'card', 'completed', NULL, 1, '2026-05-26 03:20:56', '2026-05-26 03:20:56'),
('SALE-202605-0099', 'Carmen Torres', NULL, 435, 435.0, 0.0, 'online', 'completed', NULL, 1, '2026-05-26 06:15:56', '2026-05-26 06:15:56');

SET @sale_id = (SELECT COALESCE(MIN(id), 0) FROM sales) - 1;
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 113, 1, 180, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 99, 3, 90, 270);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 80, 1, 100, 100);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 57, 3, 95, 285);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 79, 1, 300, 300);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 3, 135, 405);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 74, 3, 280, 840);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 57, 5, 75, 375);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 112, 1, 200, 200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 48, 12, 24, 288);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 2, 70, 140);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 120, 1, 160, 160);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 105, 1, 35, 35);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 58, 5, 55, 275);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 29, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 4, 1, 1100, 1100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 41, 1, 500, 500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 1, 1, 1100, 1100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 116, 2, 200, 400);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 11, 2, 1040, 2080);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 3, 1, 1340, 1340);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 33, 1, 1040, 1040);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 15, 2, 2690, 5380);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 1, 2, 1100, 2200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 79, 1, 280, 280);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 4, 24, 96);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 31, 1, 1660, 1660);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 2, 40, 80);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 18, 1, 3010, 3010);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 6, 1, 3010, 3010);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 6, 70, 420);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 26, 1, 500, 500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 6, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 102, 2, 130, 260);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 111, 2, 95, 190);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 100, 1, 40, 40);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 7, 1, 1660, 1660);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 64, 3, 145, 435);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 89, 2, 70, 140);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 42, 1, 3010, 3010);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 14, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 11, 2, 2690, 5380);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 79, 1, 70, 70);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 56, 6, 40, 240);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 36, 1, 500, 500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 31, 1, 1560, 1560);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 48, 12, 30, 360);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 57, 3, 95, 285);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 98, 2, 125, 250);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 10, 1, 1040, 1040);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 16, 1, 2690, 2690);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 34, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 100, 1, 85, 85);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 91, 1, 90, 90);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 58, 1, 95, 95);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 91, 2, 135, 270);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 9, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 1, 145, 145);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 4, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 47, 12, 30, 360);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 1, 70, 70);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 74, 2, 150, 300);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 17, 1, 3010, 3010);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 82, 3, 280, 840);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 76, 1, 80, 80);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 24, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 99, 1, 100, 100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 17, 1, 3120, 3120);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 26, 1, 1100, 1100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 82, 2, 1680, 3360);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 1, 280, 280);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 44, 2, 24, 48);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 108, 1, 190, 190);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 119, 3, 160, 480);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 73, 1, 1370, 1370);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 6, 2, 2690, 5380);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 62, 3, 135, 405);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 32, 2, 1040, 2080);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 104, 2, 35, 70);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 78, 2, 145, 290);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 19, 2, 1100, 2200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 41, 1, 2500, 2500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 19, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 13, 2, 2690, 5380);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 93, 3, 280, 840);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 41, 2, 2320, 4640);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 25, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 98, 1, 70, 70);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 21, 2, 2500, 5000);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 64, 3, 135, 405);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 77, 1, 80, 80);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 113, 1, 80, 80);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 7, 1, 2500, 2500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 73, 2, 70, 140);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 72, 3, 280, 840);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 25, 2, 2500, 5000);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 51, 4, 40, 160);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 6, 2, 2500, 5000);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 5, 2, 1100, 2200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 18, 1, 1560, 1560);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 92, 2, 100, 200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 43, 2, 2690, 5380);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 91, 1, 145, 145);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 73, 2, 80, 160);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 39, 2, 2690, 5380);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 61, 3, 55, 165);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 93, 3, 100, 300);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 7, 2, 1100, 2200);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 57, 3, 95, 285);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 112, 1, 200, 200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 109, 1, 160, 160);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 95, 1, 300, 300);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 94, 2, 190, 380);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 4, 107, 428);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 3, 105, 315);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 99, 1, 125, 125);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 112, 2, 90, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 93, 1, 135, 135);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 45, 4, 38, 152);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 72, 1, 1370, 1370);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 120, 3, 190, 570);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 102, 1, 95, 95);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 84, 1, 105, 105);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 33, 1, 2500, 2500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 96, 2, 90, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 62, 1, 1680, 1680);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 7, 2, 1560, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 13, 2, 1040, 2080);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 62, 2, 140, 280);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 84, 2, 65, 130);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 26, 1, 3010, 3010);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 97, 1, 300, 300);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 101, 2, 90, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 64, 1, 40, 40);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 24, 1, 2690, 2690);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 120, 3, 90, 270);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 109, 1, 90, 90);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 65, 1, 80, 80);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 2, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 95, 1, 100, 100);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 24, 1, 2320, 2320);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 97, 1, 125, 125);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 35, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 43, 1, 500, 500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 39, 1, 2320, 2320);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 82, 2, 145, 290);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 48, 6, 97, 582);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 54, 3, 33, 99);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 90, 1, 280, 280);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 3, 280, 840);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 117, 3, 160, 480);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 74, 1, 100, 100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 69, 2, 280, 560);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 116, 2, 140, 280);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 8, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 72, 1, 150, 150);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 60, 3, 55, 165);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 1, 1370, 1370);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 104, 1, 35, 35);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 5, 1, 3010, 3010);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 37, 2, 1560, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 53, 6, 70, 420);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 24, 2, 1660, 3320);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 16, 2, 2500, 5000);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 23, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 69, 1, 40, 40);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 49, 4, 30, 120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 106, 1, 85, 85);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 30, 1, 500, 500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 32, 2, 2690, 5380);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 59, 1, 75, 75);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 1, 150, 150);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 91, 3, 120, 360);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 112, 2, 85, 170);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 7, 1, 1100, 1100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 32, 1, 1340, 1340);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 113, 2, 85, 170);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 19, 2, 1500, 3000);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 85, 2, 65, 130);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 45, 6, 97, 582);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 24, 1, 1340, 1340);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 97, 2, 90, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 69, 3, 65, 195);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 61, 5, 95, 475);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 119, 2, 160, 320);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 49, 12, 22, 264);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 1, 105, 105);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 78, 1, 190, 190);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 96, 3, 120, 360);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 49, 4, 38, 152);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 60, 3, 80, 240);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 69, 3, 165, 495);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 41, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 53, 3, 22, 66);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 6, 1, 2500, 2500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 73, 2, 125, 250);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 107, 1, 200, 200);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 32, 2, 2320, 4640);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 64, 1, 145, 145);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 83, 1, 65, 65);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 8, 1, 1660, 1660);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 68, 1, 120, 120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 5, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 108, 1, 35, 35);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 117, 1, 190, 190);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 62, 1, 40, 40);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 85, 2, 300, 600);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 63, 2, 40, 80);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 3, 2, 1100, 2200);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 68, 3, 70, 210);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 33, 1, 1660, 1660);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 105, 1, 180, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 3, 33, 99);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 35, 1, 3010, 3010);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 49, 2, 30, 60);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 1, 190, 190);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 61, 5, 80, 400);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 8, 1, 2500, 2500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 6, 1, 2500, 2500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 119, 3, 90, 270);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 10, 1, 1560, 1560);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 21, 2, 3010, 6020);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 73, 2, 150, 300);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 31, 1, 3120, 3120);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 108, 1, 180, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 10, 2, 1560, 3120);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 6, 65, 390);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 1, 1370, 1370);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 11, 1, 1100, 1100);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 14, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 12, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 1, 1, 1100, 1100);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 53, 12, 24, 288);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 14, 1, 1660, 1660);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 4, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 12, 2, 1660, 3320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 46, 2, 97, 194);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 35, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 39, 1, 1040, 1040);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 33, 2, 2690, 5380);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 32, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 93, 1, 90, 90);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 57, 2, 80, 160);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 43, 1, 2690, 2690);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 56, 3, 70, 210);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 42, 1, 1660, 1660);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 49, 4, 24, 96);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 91, 2, 70, 140);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 27, 2, 3010, 6020);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 57, 5, 75, 375);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 103, 2, 90, 180);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 58, 5, 95, 475);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 77, 1, 145, 145);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 82, 1, 1680, 1680);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 118, 1, 190, 190);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 11, 1, 1660, 1660);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 14, 1, 500, 500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 89, 3, 165, 495);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 74, 1, 145, 145);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 29, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 58, 1, 80, 80);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 48, 6, 24, 144);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 101, 1, 140, 140);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 27, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 67, 3, 140, 420);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 62, 1, 135, 135);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 1, 120, 120);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 30, 1, 1100, 1100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 103, 2, 190, 380);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 52, 6, 65, 390);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 81, 1, 1680, 1680);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 27, 1, 2690, 2690);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 36, 1, 2500, 2500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 68, 3, 1680, 5040);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 82, 3, 1370, 4110);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 41, 1, 1560, 1560);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 77, 2, 165, 330);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 11, 1, 1500, 1500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 87, 1, 100, 100);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 18, 1, 3120, 3120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 41, 1, 2500, 2500);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 16, 2, 1660, 3320);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 89, 1, 190, 190);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 118, 2, 120, 240);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 83, 1, 140, 140);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 120, 2, 90, 180);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 23, 1, 500, 500);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 84, 3, 165, 495);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 64, 3, 100, 300);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 53, 2, 107, 214);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 88, 1, 120, 120);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 63, 2, 65, 130);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 96, 1, 1370, 1370);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 99, 1, 125, 125);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 64, 2, 300, 600);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 71, 1, 165, 165);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 66, 1, 160, 160);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 34, 1, 2320, 2320);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 45, 2, 33, 66);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 111, 1, 210, 210);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 105, 2, 180, 360);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 18, 1, 2690, 2690);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 101, 1, 160, 160);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 27, 1, 2690, 2690);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 105, 2, 80, 160);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 104, 1, 200, 200);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 18, 2, 500, 1000);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 92, 1, 150, 150);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 42, 2, 1100, 2200);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 52, 12, 38, 456);
SET @sale_id = @sale_id + 1;
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (@sale_id, 94, 3, 145, 435);

-- Update stock quantities based on sales (reduce stock)
UPDATE products p 
JOIN (
    SELECT product_id, SUM(quantity) as total_sold
    FROM sale_items
    GROUP BY product_id
) si ON p.id = si.product_id
SET p.stock_quantity = GREATEST(0, p.stock_quantity - si.total_sold);

-- Create stock movement records for the sales
INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
SELECT si.product_id, 'out', -si.quantity, 'sale', si.sale_id, 
       CONCAT('Sale #', s.sale_number), s.created_at
FROM sale_items si
JOIN sales s ON si.sale_id = s.id;
