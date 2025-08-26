// firebaseConfig.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js';

/*
  IMPORTANT: Verify each field matches your Firebase console.
  - storageBucket should typically be "<projectId>.appspot.com"
  - authDomain should be "<projectId>.firebaseapp.com"
  - projectId must match exactly
*/

const firebaseConfig = {

  apiKey: "AIzaSyDE9A_KIYz8aztDiHIoDyflgn3dPJs10K8",
  authDomain: "foodmooddb.firebaseapp.com",
  projectId: "foodmooddb",
  storageBucket: "foodmooddb.appspot.app",
  messagingSenderId: "332127610320",
  appId: "1:332127610320:web:357048610e485da47505d5",
  measurementId: "G-MTBB8QZNQ6"
};

// 1) Initialize Firebase
const app  = initializeApp(firebaseConfig);

// 2) Initialize Auth & Firestore
const auth = getAuth(app);
const db   = getFirestore(app);

// 3) Export so other files can import these
export { app, auth, db };