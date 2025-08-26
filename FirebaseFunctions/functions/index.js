/**
 * Import function triggers from their respective submodules:
 * https://firebase.google.com/docs/functions
 */
const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// 1) Load Firestore Credentials (ensure filename is correct)
const serviceAccount = require("./foodmooddb-firebase-adminsdk-fbsvc-57554975cb.json");

// 2) Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://foodmooddb-default-rtdb.firebaseio.com/",
});

const db = admin.firestore();

/**
 * ✅ Cloud Function to Fetch Firestore Data
 * Example usage: https://your-region-your-project.cloudfunctions.net/getFirestoreData
 */
exports.getFirestoreData = onRequest(async (req, res) => {
  try {
    const collectionName = "users";
    const snapshot = await db.collection(collectionName).get();

    const data = [];
    snapshot.forEach((doc) => {
      data.push({id: doc.id, ...doc.data()});
    });

    logger.info("✅ Firestore Data Fetched Successfully!");
    res.json(data);
  } catch (error) {
    logger.error("❌ Error fetching Firestore data:", error);
    res.status(500).send("Error fetching Firestore data");
  }
});

// ✅ Basic Hello World Function (For Testing)
exports.helloWorld = onRequest((req, res) => {
  logger.info("✅ Hello logs!");
  res.send("🚀 Hello from Firebase!");
});
