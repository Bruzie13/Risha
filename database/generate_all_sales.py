import mysql.connector
import random
from datetime import datetime, timedelta

DB_CONFIG = {
    "host": "127.0.0.1",
    "user": "root",
    "password": "",
    "database": "risha_pet_supplies",
}

CUSTOMERS = [
    "Maria Cruz", "Jose Santos", "Ana Reyes", "Pedro Lim", "Sofia Tan",
    "Juan Dela Cruz", "Maya Villanueva", "Ramon Garcia", "Linda Aquino",
    "Carlos Mendez", "Teresa Lopez", "Roberto Sy", "Elena Castro", "Danny Go",
    "Grace Lee", "Mike Tiu", "Pearl Rivera", "Ben Chan", "Liza Soberano",
    "Tom Rodriguez", "Jenny Ortega", "Paul Soriano", "Kim Chiu", "Vince Alvarado",
    "Angie Cruz", "Rico Blanco", "Bea Alonzo", "John Lloyd", "Sarah Geronimo",
    "James Reid", "Angelica Panganiban", "Billy Crawford", "Kylie Padilla",
    "Alden Richards", "Maine Mendoza", "Coco Martin", "Julia Barretto"
]
PAYMENT_METHODS = ["cash", "cash", "cash", "card", "online"]

MONTHLY_MULTIPLIERS = {
    1: 1.3, 2: 1.0, 3: 1.1, 4: 1.0, 5: 1.0, 6: 1.1,
    7: 1.0, 8: 1.0, 9: 1.1, 10: 1.2, 11: 1.3, 12: 1.5
}
WEEKEND_MULTIPLIER = 1.5


def generate_all():
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()

    cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
    cursor.execute("TRUNCATE TABLE stock_movements")
    cursor.execute("TRUNCATE TABLE sale_items")
    cursor.execute("TRUNCATE TABLE sales")
    cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
    conn.commit()

    cursor.execute(
        "SELECT id, unit_price, stock_quantity FROM products WHERE is_active = TRUE"
    )
    products = cursor.fetchall()

    cursor.execute("SELECT id FROM users WHERE is_active = TRUE")
    users = [row[0] for row in cursor.fetchall()]
    if not users:
        users = [1]

    start_date = datetime(2024, 6, 1)
    end_date = datetime(2026, 5, 14)

    stock_adjustments = {p[0]: int(p[2] or 50) for p in products}
    sale_counter = 1
    current_date = start_date

    while current_date <= end_date:
        month_mult = MONTHLY_MULTIPLIERS.get(current_date.month, 1.0)
        is_weekend = current_date.weekday() >= 5
        daily_base = random.randint(1, 3)
        if is_weekend:
            daily_base = int(daily_base * WEEKEND_MULTIPLIER)
        daily_base = int(daily_base * month_mult)
        daily_base = max(1, min(daily_base, 5))

        for _ in range(daily_base):
            customer = random.choice(CUSTOMERS)
            payment = random.choice(PAYMENT_METHODS)
            num_items = random.randint(1, 4)
            selected = random.sample(products, min(num_items, len(products)))

            total = 0
            sale_items_data = []

            for prod_id, price, _ in selected:
                qty = random.randint(1, 5)
                subtotal = round(qty * float(price), 2)
                total += subtotal
                sale_items_data.append((prod_id, qty, float(price), subtotal))

            if total == 0:
                continue

            month_str = current_date.strftime("%Y-%m")
            sale_num_str = f"SALE-{month_str}-{sale_counter:03d}"
            sale_counter += 1

            created_at = current_date.replace(
                hour=random.randint(8, 19),
                minute=random.randint(0, 59),
                second=random.randint(0, 59),
            ).strftime("%Y-%m-%d %H:%M:%S")

            cursor.execute(
                """INSERT INTO sales (sale_number, customer_name, total_amount, final_amount, payment_method, payment_status, created_by, created_at)
                   VALUES (%s, %s, %s, %s, %s, 'completed', %s, %s)""",
                (sale_num_str, customer, total, total, payment, random.choice(users), created_at),
            )
            sale_id = cursor.lastrowid

            for prod_id, qty, price, subtotal in sale_items_data:
                cursor.execute(
                    """INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (sale_id, prod_id, qty, price, subtotal),
                )
                stock_adjustments[prod_id] = max(0, stock_adjustments[prod_id] - qty)
                cursor.execute(
                    """INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes)
                       VALUES (%s, 'out', %s, 'sale', %s, %s)""",
                    (prod_id, -qty, sale_id, f"Sale #{sale_num_str}"),
                )

        current_date += timedelta(days=1)

    for prod_id, new_stock in stock_adjustments.items():
        cursor.execute(
            "UPDATE products SET stock_quantity = %s WHERE id = %s",
            (max(5, new_stock + random.randint(10, 50)), prod_id),
        )

    conn.commit()
    cursor.close()
    conn.close()
    print(f"Generated {sale_counter - 1} sales from June 2024 to May 2026")


if __name__ == "__main__":
    generate_all()
