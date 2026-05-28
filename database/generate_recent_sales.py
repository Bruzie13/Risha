import mysql.connector
import random
from datetime import datetime, timedelta

DB_CONFIG = {
    "host": "127.0.0.1",
    "user": "root",
    "password": "",
    "database": "risha_pet_supplies",
}

PRODUCT_IDS = list(range(1, 21))
CUSTOMERS = [
    "Maria Cruz", "Jose Santos", "Ana Reyes", "Pedro Lim", "Sofia Tan",
    "Juan Dela Cruz", "Maya Villanueva", "Ramon Garcia", "Linda Aquino",
    "Carlos Mendez", "Teresa Lopez", "Roberto Sy", "Elena Castro", "Danny Go",
    "Grace Lee", "Mike Tiu", "Pearl Rivera", "Ben Chan", "Liza Soberano",
    "Tom Rodriguez", "Jenny Ortega", "Paul Soriano", "Kim Chiu", "Vince Alvarado",
    "Angie Cruz", "Rico Blanco", "Bea Alonzo", "John Lloyd", "Sarah Geronimo",
    "James Reid"
]
PAYMENT_METHODS = ["cash", "cash", "card", "online"]  # weighted

def generate_sales():
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()

    cursor.execute("SELECT id, unit_price FROM products WHERE is_active = TRUE")
    products = cursor.fetchall()

    start_date = datetime(2025, 6, 1)
    end_date = datetime(2026, 5, 14)

    sale_num = 1
    current_date = start_date

    while current_date <= end_date:
        month_str = current_date.strftime("%Y-%m")

        daily_sales = random.randint(1, 4)
        if current_date.weekday() >= 5:
            daily_sales = random.randint(2, 6)

        for _ in range(daily_sales):
            customer = random.choice(CUSTOMERS)
            payment = random.choice(PAYMENT_METHODS)
            num_items = random.randint(1, 4)
            items = random.sample(products, min(num_items, len(products)))

            total = 0
            sale_items_data = []

            for prod_id, price in items:
                qty = random.randint(1, 5)
                subtotal = round(qty * float(price), 2)
                total += subtotal
                sale_items_data.append((prod_id, qty, float(price), subtotal))

            if total == 0:
                continue

            sale_num_str = f"SALE-{month_str}-{sale_num:03d}"
            sale_num += 1
            created_at = current_date.replace(
                hour=random.randint(8, 18),
                minute=random.randint(0, 59),
                second=random.randint(0, 59)
            ).strftime("%Y-%m-%d %H:%M:%S")

            cursor.execute(
                """INSERT INTO sales (sale_number, customer_name, total_amount, final_amount, payment_method, payment_status, created_by, created_at)
                   VALUES (%s, %s, %s, %s, %s, 'completed', %s, %s)""",
                (sale_num_str, customer, total, total, payment, random.randint(1, 3), created_at)
            )

            sale_id = cursor.lastrowid

            for prod_id, qty, price, subtotal in sale_items_data:
                cursor.execute(
                    """INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (sale_id, prod_id, qty, price, subtotal)
                )
                cursor.execute(
                    "UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - %s) WHERE id = %s",
                    (qty, prod_id)
                )
                cursor.execute(
                    """INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes)
                       VALUES (%s, 'out', %s, 'sale', %s, %s)""",
                    (prod_id, -qty, sale_id, f"Sale #{sale_num_str}")
                )

        current_date += timedelta(days=1)

    conn.commit()
    cursor.close()
    conn.close()
    print(f"Generated {sale_num - 1} sales from June 2025 to May 2026")

if __name__ == "__main__":
    generate_sales()
