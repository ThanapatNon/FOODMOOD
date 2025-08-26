# script.py
import random
import os
import datetime
import threading
import time
import smtplib
from email.mime.text import MIMEText
from collections import defaultdict
from collections import Counter
import mysql.connector
from flask import Flask, request, jsonify, send_from_directory

###############################################################################
# CONFIG: DEBUG, SMTP, DB
###############################################################################
DEBUG_FILTERING = True  # For printing debug logs

def dprint(*args):
    if DEBUG_FILTERING:
        print(*args)

# SMTP / Email (Gmail example)
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "foodmoodmai@gmail.com"
SMTP_PASS = "fcsfufzdengmohjf"

# Database
DB_HOST = "127.0.0.1"
DB_USER = "root"
DB_PASS = "Tarearthforever"
DB_NAME = "foodmood_db"

###############################################################################
# FLASK APP INIT
###############################################################################
app = Flask(__name__, static_folder='.', static_url_path='')

@app.route('/')
def serve_index():
    """
    Serve the default page (mood_cards.html) at root.
    Make sure 'mood_cards.html' is in the same folder or adjust accordingly.
    """
    return app.send_static_file('mood_cards.html')

@app.route('/add_mood.html')
def serve_add_mood():
    """
    Serve add_mood.html.
    """
    return app.send_static_file('add_mood.html')

@app.route('/notification_page.html')
def serve_notification_page():
    """
    Serve notification_page.html (the new Notification UI).
    """
    return app.send_static_file('notification_page.html')

@app.route('/photo/<path:filename>')
def serve_photo(filename):
    """
    Serve images from the /photo folder.
    e.g. http://127.0.0.1:5500/photo/default-profile.png
    Make sure there's actually a file named default-profile.png inside ./photo
    """
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'photo'), filename)


###############################################################################
# HELPER FUNCTIONS
###############################################################################
def parse_bmi_range(bmi_text):
    if not bmi_text or bmi_text.strip().upper() == "N/A":
        return (None, None)
    bmi_text = bmi_text.replace('<','-')
    parts = bmi_text.split('-')
    if len(parts) == 2:
        try:
            min_b = float(parts[0].strip())
            max_b = float(parts[1].strip())
            return (min_b, max_b)
        except ValueError:
            return (None, None)
    return (None, None)

def parse_age_range(age_text):
    if not age_text:
        return (None, None)
    parts = age_text.split('-')
    if len(parts) == 2:
        try:
            min_age = int(parts[0].strip())
            max_age = int(parts[1].strip())
            return (min_age, max_age)
        except ValueError:
            pass
    return (None, None)

def normalize_blood_type(bt):
    if not bt:
        return ""
    return bt.upper().replace("+", "").replace("-", "").replace(" ", "")

###############################################################################
# FOOD SUGGESTION LOGIC (with Allergy + Blood Type + Mood + Age + BMI Filters)
###############################################################################
def generate_food_suggestions(moodentry_id, userID, moodCategoryID, open_conn=None):
    # Connect to MySQL database (reuse existing connection if provided)
    conn = open_conn or mysql.connector.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME
    )
    cursor = conn.cursor(dictionary=True)
    need_to_close_conn = not open_conn

    try:
        # [1] Fetch user profile to get birthday, bloodType, allergies, plus weight/height for BMI
        cursor.execute("""
            SELECT UserID, birthday, bloodType, allergies, weight, height
            FROM users
            WHERE UserID = %s
            LIMIT 1
        """, (userID,))
        user = cursor.fetchone()
        if not user:
            print(f"[ERROR] User not found: {userID}")
            return []

        # [2] Calculate user's age
        today = datetime.date.today()
        bday = user["birthday"]
        age = today.year - bday.year - ((today.month, today.day) < (bday.month, bday.day))

        # [3] Calculate the user’s BMI
        #    Assuming weight in kg, height in cm: BMI = weight / ( (height/100)^2 ).
        if user["height"] and user["height"] > 0:
            user_bmi = user["weight"] / ((user["height"] / 100) ** 2)
        else:
            user_bmi = 0  # Fallback if height is missing/zero

        # [4] Prepare regex patterns for bloodType, mood, and allergy filters
        blood_regex = f"(^|[ ,]){normalize_blood_type(user['bloodType'])}($|[ ,])"
        mood_regex = f"(^|[ ,]){moodCategoryID}($|[ ,])"
        allergy_names = [
            a.strip().lower()
            for a in user.get("allergies", "").split(",")
            if a.strip()
        ]

        # [5] Map allergy names to allergen IDs (AL_IDs)
        allergy_ids = []
        if allergy_names:
            placeholders = ",".join(["%s"] * len(allergy_names))
            cursor.execute(f"""
                SELECT AL_ID
                FROM allergens
                WHERE LOWER(AL_Title) IN ({placeholders})
            """, allergy_names)
            allergy_ids = list(set(row["AL_ID"] for row in cursor.fetchall()))

        # Build an OR-based regex for allergen IDs if any
        allergy_regex = "|".join(
            [f"(^|[ ,]){aid}($|[ ,])" for aid in allergy_ids]
        ) if allergy_ids else ""

        # [6] Collect exclusions for debugging:
        excluded = {
            "allergies": {},
            "bloodtype": {},
            "mood": {},
            "bmi": {},
            "age": {},
        }

        # --- Exclude by Allergy ---
        if allergy_regex:
            cursor.execute("""
                SELECT DISTINCT fi.FoodID, i.IngredientName
                FROM food_ingredient fi
                JOIN ingredients i ON fi.IngredientID = i.IngredientID
                WHERE i.Allergy REGEXP %s
            """, (allergy_regex,))
            for row in cursor.fetchall():
                excluded["allergies"].setdefault(row["FoodID"], []).append(row["IngredientName"])

        # --- Exclude by Blood Type mismatch ---
        cursor.execute("""
            SELECT DISTINCT fi.FoodID
            FROM food_ingredient fi
            JOIN ingredients i ON fi.IngredientID = i.IngredientID
            WHERE NOT (i.BloodType REGEXP %s)
        """, (blood_regex,))
        for row in cursor.fetchall():
            excluded["bloodtype"].setdefault(row["FoodID"], []).append("Blood mismatch")

        # --- Exclude by Mood mismatch ---
        cursor.execute("""
            SELECT DISTINCT f.FoodID
            FROM fooditems f
            WHERE NOT (f.MoodCategoryID REGEXP %s)
        """, (mood_regex,))
        for row in cursor.fetchall():
            excluded["mood"].setdefault(row["FoodID"], []).append("Mood mismatch")

        # --- Exclude by BMI mismatch ---
        # If user's BMI >= 25, exclude all foods with BMI = '<25'
        if user_bmi >= 25:
            cursor.execute("""
                SELECT FoodID
                FROM fooditems
                WHERE BMI = '<25'
            """)
            for row in cursor.fetchall():
                excluded["bmi"].setdefault(row["FoodID"], []).append(
                    f"User BMI={user_bmi:.2f} >= 25"
                )

        # --- Exclude by Age mismatch ---
        cursor.execute("""
            SELECT DISTINCT f.FoodID, f.age_range
            FROM fooditems f
            WHERE NOT (
                CAST(SUBSTRING_INDEX(REPLACE(f.age_range, '–', '-'), '-', 1) AS UNSIGNED) <= %s
                AND CAST(SUBSTRING_INDEX(REPLACE(f.age_range, '–', '-'), '-', -1) AS UNSIGNED) >= %s
            )
        """, (age, age))
        for row in cursor.fetchall():
            excluded["age"].setdefault(row["FoodID"], []).append(
                f"Not in age_range {row['age_range']}"
            )

        # --- Debug print: All Exclusions ---
        print("=== [❌ EXCLUDED] Foods by reason ===")
        all_excluded = set()
        for reason, items in excluded.items():
            for food_id, details in items.items():
                all_excluded.add(food_id)
                print(f"[X] {food_id} — excluded by {reason}: {', '.join(details)}")

        # [7] Build the main SELECT for *allowed* foods only
        #     Conditions needed:
        #       - MoodCategoryID matches
        #       - Age is within range
        #       - BloodType matches
        #       - *Optional* allergies not present
        #       - BMI check
        # We’ll incorporate BMI by including either (f.BMI='N/A') or (f.BMI='<25' if user_bmi<25).
        if user_bmi < 25:
            bmi_condition = "(f.BMI = 'N/A' OR f.BMI = '<25')"
        else:
            bmi_condition = "(f.BMI = 'N/A')"

        sql = f"""
            SELECT DISTINCT fi.FoodID
            FROM food_ingredient fi
            JOIN ingredients i ON fi.IngredientID = i.IngredientID
            JOIN fooditems f ON fi.FoodID = f.FoodID
            WHERE f.MoodCategoryID REGEXP %s
              AND {bmi_condition}
              AND CAST(SUBSTRING_INDEX(REPLACE(f.age_range, '–', '-'), '-', 1) AS UNSIGNED) <= %s
              AND CAST(SUBSTRING_INDEX(REPLACE(f.age_range, '–', '-'), '-', -1) AS UNSIGNED) >= %s
              AND i.BloodType REGEXP %s
        """

        params = [mood_regex, age, age, blood_regex]

        # If the user has any allergy, exclude foods containing those allergens
        if allergy_regex:
            sql += """
                AND fi.FoodID NOT IN (
                    SELECT fi2.FoodID
                    FROM food_ingredient fi2
                    JOIN ingredients i2 ON fi2.IngredientID = i2.IngredientID
                    WHERE i2.Allergy REGEXP %s
                )
            """
            params.append(allergy_regex)

        cursor.execute(sql, params)

        # Sort by numeric portion of FoodID (assuming format like "F019", "F020", etc.)
        food_ids = sorted(
            (row["FoodID"] for row in cursor.fetchall()),
            key=lambda x: int(x[1:])
        )

        # [8] Randomize and keep at most 3
        random.shuffle(food_ids)
        final_food_ids = food_ids[:3]

        # [9] Insert into foodsuggestion table
        insert_cursor = conn.cursor()
        inserted_count = 0
        for food_id in final_food_ids:
            insert_cursor.execute("""
                INSERT INTO foodsuggestion (MoodEntryID, UserID, FoodID, MoodCategoryID, SuggestedDate)
                VALUES (%s, %s, %s, %s, NOW())
            """, (moodentry_id, userID, food_id, moodCategoryID))
            inserted_count += 1
        conn.commit()
        insert_cursor.close()

        # [10] Debug: Final Output
        print("=== [✔] Final Food Suggestions ===")
        for idx, food_id in enumerate(final_food_ids, start=1):
            print(f"[{idx:02}] Suggested FoodID: {food_id}")
        print(f"✅ Inserted {inserted_count} new suggestions.")

        return final_food_ids

    except Exception as e:
        print(f"[❌ ERROR] {e}")
        if conn:
            conn.rollback()
        return []
    finally:
        if cursor:
            cursor.close()
        if need_to_close_conn:
            conn.close()
###############################################################################
# MOOD ENTRY ENDPOINTS
###############################################################################
@app.route('/save_mood', methods=['POST'])
def save_mood():
    data = request.get_json()
    userID         = data.get('userID')
    moodCategoryID = data.get('moodCategoryID')  # e.g. "MD01"
    moodIntensity  = data.get('moodIntensity', 5)

    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()
        insert_sql = """
            INSERT INTO moodentry (UserID, MoodCategoryID, MoodIntensity, DateTime)
            VALUES (%s, %s, %s, NOW())
        """
        cursor.execute(insert_sql, (userID, moodCategoryID, moodIntensity))
        conn.commit()

        moodentry_id = cursor.lastrowid
        # Generate suggestions now that we have a moodentry_id
        generate_food_suggestions(moodentry_id, userID, moodCategoryID, open_conn=conn)

        return jsonify(success=True)

    except Exception as e:
        print("Error inserting mood:", e)
        return jsonify(success=False, error=str(e))       
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route('/moodentry', methods=['GET'])
def get_mood_entries():
    user_id = request.args.get('userId', None)
    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()

        if user_id:
            sql = """SELECT MoodEntryID, UserID, MoodCategoryID, MoodIntensity, DateTime
                     FROM moodentry
                     WHERE UserID = %s
                     ORDER BY DateTime DESC"""
            cursor.execute(sql, (user_id,))
        else:
            sql = """SELECT MoodEntryID, UserID, MoodCategoryID, MoodIntensity, DateTime
                     FROM moodentry
                     ORDER BY DateTime DESC"""
            cursor.execute(sql)

        rows = cursor.fetchall()
        data = []
        for row in rows:
            moodentry_id, db_user_id, category_code, intensity, dt = row
            date_label = dt.strftime("%b %d") if dt else "Jan 01"
            time_label = dt.strftime("%H:%M") if dt else "00:00"

            data.append({
                "MoodEntryID": moodentry_id,
                "userId":      db_user_id,
                "mood":        (category_code or "").upper().strip(),
                "intensity":   intensity,
                "dateLabel":   date_label,
                "timeLabel":   time_label
            })
        return jsonify(data)

    except Exception as e:
        print("Error fetching mood entries:", e)
        return jsonify([]), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

###############################################################################
# FOOD ITEMS ENDPOINTS
###############################################################################
@app.route('/ourmenu', methods=['GET'])
def get_our_menu():
    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()
        sql = """SELECT FoodID, FoodName, ImageURL FROM fooditems ORDER BY FoodID"""
        cursor.execute(sql)
        rows = cursor.fetchall()
        data = [{"FoodID": food_id, "FoodName": food_name, "ImageURL": image_url} 
                for food_id, food_name, image_url in rows]
        return jsonify(data)

    except Exception as e:
        print("Error fetching food items:", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

###############################################################################
# MOOD SUMMARY (OPTIONAL)
###############################################################################
@app.route('/moodsummary', methods=['GET'])
def mood_summary():
    range_param = request.args.get('range', 'weekly')  # 'weekly' or 'monthly'
    user_id     = request.args.get('userId', None)

    days_back = 7 if range_param == 'weekly' else 30

    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()

        if user_id:
            sql = """SELECT MoodCategoryID
                     FROM moodentry
                     WHERE UserID = %s
                       AND DateTime >= NOW() - INTERVAL %s DAY"""
            cursor.execute(sql, (user_id, days_back))
        else:
            sql = """SELECT MoodCategoryID
                     FROM moodentry
                     WHERE DateTime >= NOW() - INTERVAL %s DAY"""
            cursor.execute(sql, (days_back,))

        rows = cursor.fetchall()
        mood_counts = {}
        total = 0
        for (category_code,) in rows:
            code = (category_code or "").upper().strip()
            mood_counts[code] = mood_counts.get(code, 0) + 1
            total += 1

        return jsonify({"total": total, "counts": mood_counts})

    except Exception as e:
        print("Error in mood_summary:", e)
        return jsonify({"total": 0, "counts": {}}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

###############################################################################
# FOOD SUGGESTION ENDPOINTS
###############################################################################
@app.route('/foodsuggestion', methods=['GET'])
def get_food_suggestions():
    user_id = request.args.get('userId')
    if not user_id:
        return jsonify([]), 400

    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor(dictionary=True)

        # 1️⃣: Find latest MoodEntryID for the user
        cursor.execute("""
            SELECT MoodEntryID
            FROM moodentry
            WHERE UserID = %s
            ORDER BY DateTime DESC
            LIMIT 1
        """, (user_id,))
        moodentry = cursor.fetchone()
        if not moodentry:
            return jsonify([])

        latest_moodentry_id = moodentry["MoodEntryID"]

        # 2️⃣: Fetch 3 suggestions from latest moodentry only
        cursor.execute("""
            SELECT fs.SuggestionID,
                   fs.FoodID,
                   fi.FoodName,
                   fi.ImageURL,
                   fs.MoodCategoryID,
                   fs.SuggestedDate,
                   fs.EatenFlag
            FROM foodsuggestion fs
            JOIN fooditems fi ON fs.FoodID = fi.FoodID
            WHERE fs.UserID = %s AND fs.MoodEntryID = %s
            ORDER BY fs.SuggestionID DESC
            LIMIT 3
        """, (user_id, latest_moodentry_id))

        rows = cursor.fetchall()
        return jsonify(rows)

    except Exception as e:
        print("Error fetching food suggestions:", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


###############################################################################
# FOOD INGREDIENT ENDPOINTS
###############################################################################
@app.route('/foodingredient', methods=['GET'])
def get_food_ingredients():
    food_id = request.args.get('foodId')
    if not food_id:
        return jsonify({"food": None, "ingredients": []}), 400

    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor(dictionary=True)

        # main food item
        sql_food = """
            SELECT FoodID, FoodName, MoodCategoryID, BMI, Age_Range
            FROM fooditems
            WHERE FoodID = %s
            LIMIT 1
        """
        cursor.execute(sql_food, (food_id,))
        food_row = cursor.fetchone()

        # ingredients
        sql_ing = """
            SELECT i.IngredientID, i.IngredientName, i.Allergy, i.BloodType
            FROM food_ingredient fi
            JOIN ingredients i ON fi.IngredientID = i.IngredientID
            WHERE fi.FoodID = %s
        """
        cursor.execute(sql_ing, (food_id,))
        rows_ing = cursor.fetchall()

        return jsonify({"food": food_row, "ingredients": rows_ing})

    except Exception as e:
        print("Error in get_food_ingredients:", e)
        return jsonify({"food": None, "ingredients": []}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

###############################################################################
# EATEN FLAG UPDATE
###############################################################################
@app.route('/updateEatenFlag', methods=['POST'])
def update_eaten_flag():
    data = request.get_json()
    suggestion_id = data.get('suggestionId')
    if not suggestion_id:
        return "Missing suggestionId", 400

    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()
        sql = """
            UPDATE foodsuggestion
               SET EatenFlag = 'Eaten'
             WHERE SuggestionID = %s
               AND EatenFlag IS NULL
        """
        cursor.execute(sql, (suggestion_id,))
        conn.commit()
        if cursor.rowcount == 0:
            return "No matching suggestion found or already eaten.", 404
        return "OK", 200

    except Exception as e:
        print("Error in update_eaten_flag:", e)
        return str(e), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def dprint(*args, **kwargs):
    """ Helper for debug printing. """
    print(*args, **kwargs)

###############################################################################
# NOTIFICATIONS & EMAIL REMINDERS
###############################################################################
def send_email_reminder(to_email):
    """
    Sends a simple reminder email.
    """
    subject = "🌟 FoodMood Reminder – Time to Treat Yourself! 🌟"
    body = (
        "Hey there! 😊 Just a little reminder from FoodMood to check in on your next meal or mood update. "
        "🍽️✨ Take a moment for yourself—whether it's a delicious bite or a mindful check-in, you deserve it! 💛 "
        "Stay happy & nourished! 🌿💖"
    )
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = to_email

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        dprint(f"[INFO] Reminder email sent to {to_email}")
    except Exception as e:
        dprint(f"[ERROR] Failed to send email to {to_email}: {e}")

def calc_next_time(old_time, freq):
    """
    Calculates the next RemindTime based on the chosen frequency.
    Return None if freq='once' or unknown => no repeat.
    """
    if freq == "once":
        return None
    elif freq == "daily":
        return old_time + datetime.timedelta(days=1)
    elif freq == "3days":
        return old_time + datetime.timedelta(days=3)
    elif freq == "5days":
        return old_time + datetime.timedelta(days=5)
    elif freq == "weekly":
        return old_time + datetime.timedelta(weeks=1)
    elif freq == "monthly":
        # naive approach: add ~30 days
        return old_time + datetime.timedelta(days=30)
    else:
        return None

def reminder_thread():
    """
    Background thread that runs every 60s, checks notifications table for due items.
    If a notification is due (SentFlag=0 and RemindTime <= NOW()):
      1) We "claim" it with an UPDATE WHERE SentFlag=0
      2) If rowcount == 1 (we claimed it), we send the email
      3) If freq != 'once', we schedule the next occurrence
    """
    while True:
        try:
            conn = mysql.connector.connect(
                host=DB_HOST,
                user=DB_USER,
                password=DB_PASS,
                database=DB_NAME
            )
            cursor = conn.cursor(dictionary=True)

            # 1) Find all unsent, due notifications
            sql_fetch = """
                SELECT NotificationID, Email, RemindTime, Frequency
                FROM notifications
                WHERE SentFlag = 0
                  AND RemindTime <= NOW()
            """
            cursor.execute(sql_fetch)
            rows = cursor.fetchall()

            for notif in rows:
                notif_id  = notif["NotificationID"]
                email     = notif["Email"]
                old_time  = notif["RemindTime"]
                freq      = notif["Frequency"] or "once"

                # 2) Attempt to 'claim' the notification
                sql_claim = """
                  UPDATE notifications
                  SET SentFlag=1
                  WHERE NotificationID=%s AND SentFlag=0
                """
                cursor.execute(sql_claim, (notif_id,))
                
                # If rowcount==0, another process/thread already claimed/sent it
                if cursor.rowcount == 0:
                    continue

                # 3) Now safe to send the email
                send_email_reminder(email)

                # 4) If freq != 'once', schedule the next occurrence
                new_time = calc_next_time(old_time, freq)
                if new_time:
                    sql_insert = """
                      INSERT INTO notifications (Email, RemindTime, CreatedAt, SentFlag, Frequency)
                      VALUES (%s, %s, NOW(), 0, %s)
                    """
                    cursor.execute(sql_insert, (email, new_time, freq))

            conn.commit()
            cursor.close()
            conn.close()
        except Exception as e:
            dprint("[ERROR] In reminder_thread:", e)

        time.sleep(60)  # check every minute

# Start the background thread on app startup
threading.Thread(target=reminder_thread, daemon=True).start()

@app.route('/schedule_reminder', methods=['POST'])
def schedule_reminder():
    """
    POST JSON: { "email": "...", "reminderDate": "YYYY-MM-DDTHH:MM", "frequency": "once|daily|3days|..." }
      Insert into notifications => 
        Email, RemindTime=that date/time, CreatedAt=NOW(), SentFlag=0, Frequency
    """
    dprint("DEBUG: Entered schedule_reminder route")
    try:
        data = request.get_json(force=True)
        email        = data.get('email')
        reminder_str = data.get('reminderDate')
        frequency    = data.get('frequency', 'once')

        if not email:
            return jsonify(success=False, error="Missing email"), 400
        if not reminder_str:
            return jsonify(success=False, error="Missing reminderDate"), 400

        # Parse the 'YYYY-MM-DDTHH:MM' from the client.
        remind_time = datetime.datetime.fromisoformat(reminder_str)

        created_at  = datetime.datetime.now()

        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()

        sql = """
          INSERT INTO notifications (Email, RemindTime, CreatedAt, SentFlag, Frequency)
          VALUES (%s, %s, %s, 0, %s)
        """
        cursor.execute(sql, (email, remind_time, created_at, frequency))
        conn.commit()

        cursor.close()
        conn.close()

        dprint(f"[INFO] Inserted notification for {email}, on {remind_time}. freq={frequency}")
        return jsonify(success=True)
    except Exception as e:
        dprint("[ERROR in schedule_reminder]:", e)
        return jsonify(success=False, error=str(e)), 500

# -------------------------------------------------------
# GET FOOD INFO (Eaten Page)
# -------------------------------------------------------
@app.route('/food_eaten_info', methods=['GET'])
def get_food_eaten_info():
    food_id = request.args.get('foodId')
    if not food_id:
        return jsonify({"error": "Missing foodId"}), 400

    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor(dictionary=True)

        sql = """
            SELECT FoodID, FoodName, ImageURL
            FROM fooditems
            WHERE FoodID = %s
            LIMIT 1
        """
        cursor.execute(sql, (food_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": f"No item found for FoodID={food_id}"}), 404
        return jsonify(row), 200

    except Exception as e:
        print("[ERROR] /food_eaten_info:", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# -------------------------------------------------------
# STORE EATEN FEEDBACK
# -------------------------------------------------------
@app.route('/store_eaten_feedback', methods=['POST'])
def store_eaten_feedback():
    """
    Expects JSON: { userId, foodId, feeling }
    We'll store codes like MD01, MD02, MD03, MD04 in FeelBetter.
    """
    try:
        data        = request.get_json(force=True)
        user_id     = data.get('userId')
        food_id     = data.get('foodId')
        feeling_str = data.get('feeling')  # "Happy", "Sad", "Angry", "Neutral"

        if not user_id or not food_id or not feeling_str:
            return jsonify(success=False, error="Missing userId, foodId, or feeling"), 400

        # New map from mood string to code
        feeling_map = {
            "Happy":   "MD01",
            "Sad":     "MD02",
            "Angry":   "MD03",
            "Neutral": "MD04"
        }

        # Default to MD04 ("Neutral") if not recognized
        feeling_code = feeling_map.get(feeling_str, "MD04")

        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()

        insert_sql = """
            INSERT INTO user_eaten (UserID, FoodID, EatenDateTime, FeelBetter)
            VALUES (%s, %s, NOW(), %s)
        """
        cursor.execute(insert_sql, (user_id, food_id, feeling_code))
        conn.commit()

        cursor.close()
        conn.close()
        return jsonify(success=True), 200

    except Exception as e:
        print("[ERROR] store_eaten_feedback:", e)
        return jsonify(success=False, error=str(e)), 500
# -------------------------------------------------------
# REPORT PAGE
# -------------------------------------------------------
@app.route('/report_data', methods=['GET'])
def report_data():
    """
    Returns JSON for the report page:
      - Eaten meals (via user_eaten).
      - Mood 'before' from foodsuggestion.MoodCategoryID (no join to moodcategory table).
      - A local mapping (dictionary) is used to translate MoodCategoryID to a mood name.
      - Mood 'after' from user_eaten.FeelBetter (which could be an int or an MD-code).
    """
    user_id        = request.args.get('userId')
    start_date_str = request.args.get('start')
    end_date_str   = request.args.get('end')

    if not (user_id and start_date_str and end_date_str):
        return jsonify({"error": "Missing userId, start or end parameters"}), 400

    # Parse the date range
    try:
        start_date = datetime.datetime.strptime(start_date_str, "%Y-%m-%d")
        end_date   = datetime.datetime.strptime(end_date_str,   "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

    # Extend end_date by one day to include the entire end date
    end_date += datetime.timedelta(days=1)

    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor(dictionary=True)

        # Grab user_eaten + related info
        sql = """
        SELECT 
            ue.UserID,
            ue.FoodID,
            ue.EatenDateTime,
            ue.FeelBetter,
            fi.FoodName       AS EatenFoodName,
            fi.ImageURL       AS EatenFoodImage,
            fs.MoodCategoryID AS MoodBeforeID
        FROM user_eaten ue
        JOIN fooditems fi 
               ON ue.FoodID = fi.FoodID
        LEFT JOIN foodsuggestion fs 
               ON fs.UserID = ue.UserID
              AND fs.FoodID = ue.FoodID
        WHERE ue.UserID = %s
          AND ue.EatenDateTime >= %s
          AND ue.EatenDateTime < %s
        ORDER BY ue.EatenDateTime DESC
        """

        cursor.execute(sql, (user_id, start_date, end_date))
        rows = cursor.fetchall()

        # We'll track "before" (MD01..MD04) and "after" in separate counters
        # Mood BEFORE => MD01, MD02, MD03, MD04
        mood_before_counts = {
            "MD01": 0,
            "MD02": 0,
            "MD03": 0,
            "MD04": 0
        }
        # If after is storing "Better","Same","Worse" or MD-codes, let's unify:
        # We'll store counts by "Happy","Sad","Angry","Neutral" OR "Better","Same","Worse".
        mood_after_counts = {
            "Happy":  0,
            "Sad":    0,
            "Angry":  0,
            "Neutral":0,
            "Better": 0,
            "Same":   0,
            "Worse":  0
        }

        # Maps for MoodCategoryID => label
        mood_label_map = {
            "MD01": "Happy",
            "MD02": "Sad",
            "MD03": "Angry",
            "MD04": "Neutral"
        }

        table_data = []

        for row in rows:
            eaten_food_name  = row["EatenFoodName"] or "Unknown Food"
            eaten_food_image = row["EatenFoodImage"] or "/images/default_food.png"

            # Format date/time
            dt_str = ""
            if row["EatenDateTime"]:
                dt_str = row["EatenDateTime"].strftime("%Y-%m-%d %H:%M")

            # Mood BEFORE
            mood_before_id = row["MoodBeforeID"]
            mood_before_label = "Unknown"
            if mood_before_id and mood_before_id in mood_before_counts:
                # increment the counter for that code
                mood_before_counts[mood_before_id] += 1
                mood_before_label = mood_label_map.get(mood_before_id, "Unknown")
            else:
                # Either no code or something unrecognized
                # We can keep "Unknown" or skip
                pass

            # Mood AFTER
            # If user is storing 1 => "Better", 0 => "Same", -1 => "Worse"
            # or if storing an MD code => "Happy","Sad","Angry","Neutral"
            fb_val = row["FeelBetter"]  # could be int or string

            mood_after_label = ""
            if fb_val is not None:
                if isinstance(fb_val, int):
                    # The old logic: 1 => "Better", 0 => "Same", -1 => "Worse"
                    if fb_val == 1:
                        mood_after_label = "Better"
                        mood_after_counts["Better"] += 1
                    elif fb_val == 0:
                        mood_after_label = "Same"
                        mood_after_counts["Same"] += 1
                    elif fb_val == -1:
                        mood_after_label = "Worse"
                        mood_after_counts["Worse"] += 1
                else:
                    # Assume string, e.g. "MD01","MD02","MD03","MD04"
                    # or "Better","Same","Worse" if user stored text
                    fb_str = str(fb_val).strip()
                    if fb_str in mood_label_map:
                        # e.g. "MD01" => "Happy"
                        mood_after_label = mood_label_map[fb_str]
                        mood_after_counts[mood_after_label] += 1
                    elif fb_str in mood_after_counts:
                        # e.g. "Better","Same","Worse"
                        mood_after_label = fb_str
                        mood_after_counts[fb_str] += 1
                    else:
                        # unknown string
                        mood_after_label = "Unknown"

            # Build the table row
            table_data.append({
                "foodImage":  eaten_food_image,
                "foodName":   eaten_food_name,
                "dateTime":   dt_str,
                "moodBefore": mood_before_label,
                "moodAfter":  mood_after_label
            })

        total_meals = len(table_data)

        # Convert mood_before_counts => array of {label, count}
        # We only have 4 codes for "before" => MD01..MD04 => ["Happy","Sad","Angry","Neutral"]
        # We'll keep the same old approach.
        mood_bar_data = []
        for code, cnt in mood_before_counts.items():
            lbl = mood_label_map.get(code, "Unknown")
            mood_bar_data.append({"label": lbl, "count": cnt})

        # For "after," we have 7 possible keys in mood_after_counts
        # but maybe you only want 4? If you only care about MD-codes or only about Better/Same/Worse,
        # you can filter. Otherwise, let's keep them all.
        mood_after_bar_data = []
        # We'll use a stable order: "Happy","Sad","Angry","Neutral","Better","Same","Worse"
        after_order = ["Happy","Sad","Angry","Neutral","Better","Same","Worse"]
        for lbl in after_order:
            cnt = mood_after_counts[lbl]
            mood_after_bar_data.append({"label": lbl, "count": cnt})

        # Build final result
        result = {
            "tableData":        table_data,
            "totalMeals":       total_meals,
            "moodBarData":      mood_bar_data,       # Mood BEFORE
            "moodAfterBarData": mood_after_bar_data  # Mood AFTER
        }
        return jsonify(result)

    except Exception as e:
        print("Error in /report_data:", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

###############################################################################
#history_suggestion.html
###############################################################################
@app.route('/foodsugg_history', methods=['GET'])
def get_food_suggestion_history():
    user_id = request.args.get('userId')
    if not user_id:
        return jsonify({"error": "Missing userId"}), 400

    try:
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor(dictionary=True)

        sql = """
        SELECT 
            fs.SuggestionID,
            fs.FoodID,
            fi.FoodName,
            fi.ImageURL,
            fs.MoodCategoryID,
            fs.SuggestedDate,
            fs.EatenFlag
        FROM foodsuggestion fs
        JOIN fooditems fi 
          ON fs.FoodID = fi.FoodID
        WHERE fs.UserID = %s
        ORDER BY fs.SuggestedDate DESC
        """
        cursor.execute(sql, (user_id,))
        rows = cursor.fetchall()
        return jsonify(rows)

    except Exception as e:
        print("Error in get_food_suggestion_history:", e)
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()
# -----------------------------------------------------------------------------
# MAIN ENTRY POINT
# -----------------------------------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True, port=5500)