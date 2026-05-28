#!/bin/bash
DB_NAME="risha_pet_supplies"
DB_USER="root"
DB_PASSWORD=""
BACKUP_DIR="/Users/gracie22/Desktop/THESIS/backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
mkdir -p "$BACKUP_DIR"
mysqldump -u "$DB_USER" ${DB_PASSWORD:+-p"$DB_PASSWORD"} "$DB_NAME" > "$BACKUP_DIR/${DB_NAME}_${DATE}.sql"
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql" -type f -mtime +30 -delete
echo "Backup completed: $BACKUP_DIR/${DB_NAME}_${DATE}.sql"
