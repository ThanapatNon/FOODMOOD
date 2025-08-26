import os
import logging
import time
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
import mysql.connector
import grpc
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)

# Load environment variables from .env
load_dotenv()

# Database configuration
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "Tarearthforever")
DB_NAME = os.getenv("DB_NAME", "FOODMOOD_DB")

# Firebase credentials file
FIREBASE_CRED_PATH = "C:\\Users\\Administrator\\Desktop\\FOODMOOD Website\\FOODMOOD_DB_v4.0\\v1\\FirebaseFunctions\\functions\\foodmooddb-firebase-adminsdk-fbsvc-57554975cb.json"

# Initialize Firebase
try:
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred)
        logging.info("Firebase initialized successfully.")
except Exception as e:
    logging.error(f"Error initializing Firebase: {e}")
    exit(1)

# Firestore Database
db = firestore.client()

# Connect to MySQL
try:
    connection = mysql.connector.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME
    )
    cursor = connection.cursor()
    logging.info("Connected to MySQL database successfully.")
except mysql.connector.Error as err:
    logging.error(f"Error connecting to MySQL: {err}")
    exit(1)

# Track how many users we insert/update/delete
insert_count = 0
update_count = 0
delete_count = 0

try:
    # 1) Fetch all users from Firestore
    users_ref = db.collection("users").stream()
    firestore_docs = list(users_ref)  # Convert to list so we can count them
    firestore_users = set()

    logging.info(f"Found {len(firestore_docs)} user documents in Firestore.")

    # 2) Process each Firestore user doc
    for user_doc in firestore_docs:
        user_id = user_doc.id
        user_data = user_doc.to_dict()

        logging.info(f"Processing user: {user_id}")

        # If no data in the document, skip
        if not user_data:
            logging.warning(f"User {user_id} has an empty document; skipping.")
            continue

        firestore_users.add(user_id)

        # Extract nested healthData fields
        health_data = user_data.get("healthData", {})
        weight = health_data.get("weight", 0)
        height = health_data.get("height", 0)
        birthday_str = health_data.get("birthday", "2000-01-01")
        allergies_list = health_data.get("allergies", [])
        blood_type = health_data.get("bloodType", "Unknown")

        # Convert allergies list to comma-separated string
        if not isinstance(allergies_list, list):
            allergies_list = []
        allergies_str = ", ".join(allergies_list)

        # Attempt to parse birthday
        try:
            birthday_parsed = datetime.strptime(birthday_str, "%Y-%m-%d").date()
        except ValueError:
            logging.warning(
                f"Invalid birthday '{birthday_str}' for user {user_id}, using default 2000-01-01."
            )
            birthday_parsed = datetime(2000, 1, 1).date()

        # 3) Check if user exists in MySQL
        cursor.execute("SELECT UserID FROM users WHERE UserID = %s", (user_id,))
        result = cursor.fetchone()

        if not result:
            # 4) User does NOT exist => INSERT
            cursor.execute(
                """
                INSERT INTO users (UserID, weight, height, birthday, allergies, bloodType)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user_id, weight, height, birthday_parsed, allergies_str, blood_type)
            )
            connection.commit()
            insert_count += 1
            logging.info(f"Inserted user {user_id} into MySQL.")
        else:
            # 5) User EXISTS => UPDATE
            cursor.execute(
                """
                UPDATE users
                SET weight = %s,
                    height = %s,
                    birthday = %s,
                    allergies = %s,
                    bloodType = %s
                WHERE UserID = %s
                """,
                (weight, height, birthday_parsed, allergies_str, blood_type, user_id)
            )
            connection.commit()
            update_count += 1
            logging.info(f"Updated user {user_id} in MySQL.")

    # 6) Identify MySQL users that are not in Firestore => DELETE them
    cursor.execute("SELECT UserID FROM users")
    mysql_users = {row[0] for row in cursor.fetchall()}

    # The set difference
    users_to_delete = mysql_users - firestore_users

    for user_id in users_to_delete:
        cursor.execute("DELETE FROM users WHERE UserID = %s", (user_id,))
        connection.commit()
        delete_count += 1
        logging.info(f"Deleted user {user_id} from MySQL (not found in Firestore).")

except grpc.RpcError as grpc_err:
    logging.error(f"gRPC error: {grpc_err.code()} - {grpc_err.details()}")
    time.sleep(2)  # Small retry delay if needed
except mysql.connector.Error as err:
    logging.error(f"Database error: {err}")
except Exception as e:
    logging.error(f"Unexpected error: {e}")
finally:
    if cursor:
        cursor.close()
    if connection:
        connection.close()
    logging.info("Database connection closed.")

# Final summary
logging.info(
    f"Sync complete. Inserted: {insert_count}, Updated: {update_count}, Deleted: {delete_count}."
)