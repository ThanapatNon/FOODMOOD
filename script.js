/***************************************************************
 * script.js — Comprehensive Main Logic for FOODMOOD
 *
 * INCLUDES:
 *   1) Firebase Auth (Email/Pass, Google, Phone OTP, Forgot PW)
 *   2) Registration Steps (1 & 2)
 *   3) Profile Page Logic (view/update health data, delete acct)
 *   4) Mood Tracking & Summaries
 *   5) Menu & Food Suggestions
 *   6) Mark Foods as "Eaten" + capturing feedback
 *   7) Notification scheduling
 *   8) Reports (Chart for Mood Before/After)
 *   9) UI Enhancements (confetti, overlays, etc.)
 ***************************************************************/

/***************************************************************
 * ==================== IMPORTS ================================
 ***************************************************************/
import { auth, db } from './firebaseConfig.js';
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser
} from 'https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js';

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js';

/***************************************************************
 * =========== SECTION A: GLOBAL HELPER FUNCTIONS ==============
 ***************************************************************/

/** Get an element by ID quickly. */
function $id(id) {
  return document.getElementById(id);
}

/**
 * Maps Firebase Auth error codes to user-friendly messages.
 */
function getFriendlyErrorMessage(error) {
  switch (error.code) {
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/user-disabled':
      return 'User account is disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Try again later.';
    case 'auth/invalid-phone-number':
      return 'Invalid phone number format.';
    case 'auth/recaptcha-not-ready':
      return 'ReCAPTCHA not ready. Refresh and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * After a user logs in, check if they have completed "Health Data."
 * If yes, go to main.html; otherwise, go to register2.html.
 */
async function redirectBasedOnHealthData(user) {
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const docSnap    = await getDoc(userDocRef);
    if (docSnap.exists() && docSnap.data().healthData) {
      window.location.href = 'main.html';
    } else {
      window.location.href = 'register2.html';
    }
  } catch (err) {
    console.error('Error checking user data:', err);
    alert('Unable to check user data. Please try again.');
    window.location.href = 'error.html';
  }
}

/**
 * Load the user’s displayName / photo from Auth or Firestore
 * and update #userName, #userPhoto, etc.
 * 
 * If no user photo is found, we fall back to "foodmood_logo_icon_copy-removebg-preview.png".
 */
async function loadUserInfo(user) {
  const userPhotoElem = $id('userPhoto');
  const userNameElem  = $id('userName');
  if (!userPhotoElem && !userNameElem) return;

  try {
    // Default fallback from auth user
    let displayName = 
        user.displayName    || 
        user.phoneNumber    || 
        user.email          ||
        'User';
    let photoUrl    = user.photoURL || 'photo/foodmood_logo_icon_copy-removebg-preview.png';

    // Check Firestore for additional info
    const userDocRef = doc(db, 'users', user.uid);
    const docSnap    = await getDoc(userDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();

      // If you store phone number, you can check that here too
      // Priority: fullName -> phoneNumber -> displayName
      if (data.fullName) {
        displayName = data.fullName;
      } else if (data.phoneNumber) {
        displayName = data.phoneNumber;
      } else if (data.displayName) {
        displayName = data.displayName;
      }

      // If user has custom photo in Firestore, use that
      if (data.photoUrl) {
        photoUrl = data.photoUrl;
      }
    }

    // Update the DOM
    if (userNameElem) {
      userNameElem.textContent = displayName;
    }

    if (userPhotoElem) {
      userPhotoElem.src = photoUrl;
      // Fallback to the FoodMood logo if the photo fails to load
      userPhotoElem.onerror = () => {
        userPhotoElem.onerror = null;
        userPhotoElem.src = 'photo/foodmood_logo_icon_copy-removebg-preview.png';
      };
    }
  } catch (err) {
    console.error('Error loading user info:', err);
  }
}

/** Launch a pink-ish confetti effect for ~3 seconds. */
function launchConfetti() {
  const confettiWrapper = $id('confettiWrapper');
  if (!confettiWrapper) return;

  const confettiColors = ['#FFC0CB', '#FFB6C1', '#FFD1DC', '#FFA6BF', '#FFF0F5'];
  const NUM_CONFETTI = 30;
  confettiWrapper.innerHTML = '';

  for (let i = 0; i < NUM_CONFETTI; i++) {
    const confetti = document.createElement('span');
    confetti.classList.add('confetti');

    const colorIndex = Math.floor(Math.random() * confettiColors.length);
    confetti.style.backgroundColor = confettiColors[colorIndex];
    confetti.style.left = `${Math.random() * 100}%`;
    const size = 8 + Math.random() * 8;
    confetti.style.width = `${size}px`;
    confetti.style.height = `${size}px`;
    confetti.style.animationDelay = `${Math.random() * 0.5}s`;

    confettiWrapper.appendChild(confetti);

    setTimeout(() => {
      if (confetti.parentNode === confettiWrapper) {
        confettiWrapper.removeChild(confetti);
      }
    }, 3000 + Math.random() * 500);
  }
}

/***************************************************************
 * ========== SECTION B: NAVBAR / USER PROFILE / LOGOUT ========
 ***************************************************************/
const userProfileDiv = $id('userProfile');
const userDropdown   = $id('userDropdown');
const logoutLink     = $id('logoutLink');

if (userProfileDiv && userDropdown) {
  userProfileDiv.addEventListener('click', () => {
    userDropdown.classList.toggle('show-dropdown');
  });
}

if (logoutLink) {
  logoutLink.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await signOut(auth);
      window.location.href = 'home.html';
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  });
}

/***************************************************************
 * ========== SECTION C: LOGIN PAGE (Email, Google) ============
 ***************************************************************/
const loginEmail = $id('email');
const loginPassword = $id('password');

if (loginEmail && loginPassword) {
  // For your login.html
  window.emailLogin = async function emailLogin() {
    const email    = loginEmail.value.trim();
    const password = loginPassword.value.trim();
    if (!email || !password) {
      alert('Please enter both email and password.');
      return;
    }
    try {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      await redirectBasedOnHealthData(userCred.user);
    } catch (err) {
      alert(getFriendlyErrorMessage(err));
    }
  };

  window.googleLogin = async function googleLogin() {
    const provider = new GoogleAuthProvider();
    try {
      const userCred = await signInWithPopup(auth, provider);
      await redirectBasedOnHealthData(userCred.user);
    } catch (err) {
      alert(getFriendlyErrorMessage(err));
    }
  };
}

/***************************************************************
 * =========== SECTION D: PHONE LOGIN (OTP) FLOW ===============
 ***************************************************************/
window.startPhoneLogin = async function startPhoneLogin() {
  const phoneInput = $id('phoneNumber');
  if (!phoneInput) return;
  const phoneNumber = phoneInput.value.trim();
  if (!phoneNumber) {
    alert('Please enter a valid phone number (e.g. +66999999999).');
    return;
  }
  try {
    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', { size: 'invisible' }, auth);
    const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
    sessionStorage.setItem('verificationId', confirmationResult.verificationId);
    sessionStorage.setItem('phoneNumber', phoneNumber);
    window.location.href = 'otp.html';
  } catch (error) {
    console.error('Error sending OTP:', error);
    alert('Failed to send OTP: ' + (error.message || error));
  }
};

window.verifyOtpCode = async function verifyOtpCode() {
  const otpInput = $id('otpCode');
  if (!otpInput) return;

  const code = otpInput.value.trim();
  if (!code) {
    alert('Please enter the 6-digit code we sent you.');
    return;
  }

  try {
    const verificationId = sessionStorage.getItem('verificationId');
    if (!verificationId) {
      alert('No verificationId found. Please start again.');
      return;
    }
    const credential = PhoneAuthProvider.credential(verificationId, code);
    const userCred   = await signInWithCredential(auth, credential);
    sessionStorage.removeItem('verificationId');
    await redirectBasedOnHealthData(userCred.user);
  } catch (err) {
    console.error('Error verifying OTP:', err);
    alert('Invalid or expired code. ' + (err.message || err));
  }
};

// If phone-login page or otp page, attach event
if (document.querySelector('.phone-login-page')) {
  $id('sendOtpBtn')?.addEventListener('click', startPhoneLogin);
}
if (document.querySelector('.otp-page')) {
  const phoneDisplay = $id('phoneDisplay');
  const storedPhone  = sessionStorage.getItem('phoneNumber');
  if (phoneDisplay && storedPhone) {
    phoneDisplay.textContent = `We sent a 6-digit code to: ${storedPhone}`;
  }
  $id('verifyOtpBtn')?.addEventListener('click', verifyOtpCode);
}

/***************************************************************
 * ========== SECTION E: FORGOT PASSWORD (Email) ===============
 ***************************************************************/
window.handleForgotPassword = async function handleForgotPassword() {
  const emailInput = $id('forgotEmail');
  if (!emailInput) {
    alert('Please add an input with id="forgotEmail"');
    return;
  }
  const email = emailInput.value.trim();
  if (!email) {
    alert('Please enter your email address.');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    alert('Password reset email sent! Check your inbox/spam folder.');
    window.location.href = 'login.html';
  } catch (err) {
    console.error('Error sending reset email:', err);
    alert('Error: ' + err.message);
  }
};

/***************************************************************
 * ========== SECTION F: REGISTER PAGE (Step 1) ================
 ***************************************************************/
const registerForm = $id('register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const fullName        = $id('fullname').value.trim();
    const email           = $id('email').value.trim();
    const password        = $id('password').value.trim();
    const confirmPassword = $id('confirm-password').value.trim();

    if (!fullName || !email || !password || !confirmPassword) {
      alert('Please fill out all fields.');
      return;
    }
    if (password !== confirmPassword) {
      alert('Passwords do not match.');
      return;
    }

    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const user     = userCred.user;
      await updateProfile(user, { displayName: fullName });
      await setDoc(doc(db, 'users', user.uid), {
        name: fullName,
        email: user.email,
        createdAt: serverTimestamp()
      });
      alert('Registration successful!');
      window.location.href = 'register2.html';
    } catch (err) {
      alert('Registration failed: ' + err.message);
    }
  });
}

/***************************************************************
 * ========== SECTION G: REGISTER (Step 2) => HEALTH DATA ======
 ***************************************************************/
if (document.querySelector('.register2-page')) {
  window.saveHealthData = async function saveHealthData() {
    if (!auth.currentUser) {
      alert('No user is signed in!');
      return;
    }
    try {
      const allergyIds = Array.from({ length: 14 }, (_, i) => `allergy-${i}`);
      const selectedAllergies = allergyIds
        .map(id => $id(id))
        .filter(cb => cb && cb.checked)
        .map(cb => cb.value);

      const weightStr = $id('weight')?.value;
      const heightStr = $id('height')?.value;
      const birthday  = $id('birthday')?.value;
      const bloodType = $id('bloodType')?.value;

      if (!weightStr || !heightStr || !birthday || !bloodType) {
        alert('Please fill in weight, height, birthday, blood type (allergies optional).');
        return;
      }
      const weightNum = parseInt(weightStr, 10);
      const heightNum = parseInt(heightStr, 10);
      if (isNaN(weightNum) || weightNum < 1 || weightNum > 300) {
        alert('Weight must be 1–300.');
        return;
      }
      if (isNaN(heightNum) || heightNum < 1 || heightNum > 300) {
        alert('Height must be 1–300.');
        return;
      }
      if (new Date(birthday) > new Date()) {
        alert('Birthday cannot be in the future!');
        return;
      }

      await setDoc(
        doc(db, 'users', auth.currentUser.uid),
        {
          healthData: {
            allergies: selectedAllergies,
            weight: weightNum,
            height: heightNum,
            birthday,
            bloodType
          },
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      alert('Saved health data successfully!');
      window.location.href = 'confirm.html';
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };
}

/***************************************************************
 * ========== SECTION H: CONFIRM PAGE (after registration) =====
 ***************************************************************/
const confirmDoneBtn = $id('confirmDoneBtn');
if (confirmDoneBtn) {
  confirmDoneBtn.addEventListener('click', () => {
    window.location.href = 'welcome.html';
  });
}

if ($id('confirmPhoto')) {
  // confirm.html logic
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    const confirmPhoto   = $id('confirmPhoto');
    const confirmName    = $id('confirmName');
    const confirmEmail   = $id('confirmEmail');
    const confirmDetails = $id('confirmDetails');

    confirmPhoto.src         = user.photoURL || 'photo/foodmood_logo_icon_copy-removebg-preview.png';
    confirmName.textContent  = user.displayName || user.email || 'My Account';
    confirmEmail.textContent = user.email || 'No email';

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const docSnap    = await getDoc(userDocRef);
      if (docSnap.exists()) {
        const userData = docSnap.data();
        if (userData.healthData) {
          const { allergies=[], weight, height, birthday, bloodType } = userData.healthData;
          const allergyStr = allergies.length ? allergies.join(', ') : 'No allergies';
          // Compute age
          let ageStr = '';
          if (birthday) {
            const bd  = new Date(birthday);
            const now = new Date();
            let years = now.getFullYear() - bd.getFullYear();
            const mDiff = now.getMonth() - bd.getMonth();
            if (mDiff < 0 || (mDiff === 0 && now.getDate() < bd.getDate())) years--;
            ageStr = `${years} yrs`;
          }

          const parts = [];
          if (ageStr) parts.push(ageStr);
          if (weight) parts.push(`${weight} kg`);
          if (height) parts.push(`${height} cm`);
          if (bloodType) parts.push(`Blood Type: ${bloodType}`);
          parts.push(allergyStr);

          confirmDetails.textContent = parts.join(' | ');
        }
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
      confirmDetails.textContent = 'Error loading data.';
    }
  });
}

/***************************************************************
 * ========== SECTION I: OPTIONAL RUN FETCH-DATA ===============
 ***************************************************************/
async function runFetchData() {
  try {
    const resp = await fetch('http://127.0.0.1:3000/run-fetch-data', { method: 'POST' });
    const result = await resp.json();
    if (result.success) {
      console.log('Successfully ran fetch_data.py!', result.logs);
    } else {
      console.error('Error running fetch_data.py:', result.message, result.logs);
    }
  } catch (error) {
    console.error('Error calling /run-fetch-data:', error);
  }
}
window.runFetchData = runFetchData;

/***************************************************************
 * ========== SECTION J: ADD MOOD PAGE (pick a mood) ===========
 ***************************************************************/
if ($id('submitMoodBtn')) {
  let currentUserID = null;
  const moodCards     = document.querySelectorAll('.mood-card');
  const submitMoodBtn = $id('submitMoodBtn');
  let selectedMood    = null;

  // Optional motivational overlay
  const motivationalOverlay = $id('motivationalOverlay');
  const motivationalQuote   = $id('motivationalQuote');

  const moodQuotesMap = {
    happy: [
      'Keep shining; your light brightens every moment.',
      'Your joy is contagious; never stop sharing it.',
      'Happiness looks great on you.',
      'Celebrate the little things.',
      'Your laughter warms every heart.',
      'Spread your wings and let gratitude guide you.',
      'Embrace the sunshine within.',
      'Smiles are free, keep giving them.'
    ],
    sad: [
      'It’s okay to feel down; this too shall pass.',
      'A little rain helps flowers grow.',
      'You’re stronger than you know.',
      'Darkness will give way to the light inside you.',
      'Healing is a journey, not a race.',
      'Stormy clouds eventually clear for the sun.',
      'In every struggle, there’s a lesson.',
      'Feel to heal.'
    ],
    angry: [
      'Take a deep breath; find your calm.',
      'Anger doesn’t define you.',
      'A moment of patience prevents regret.',
      'Breathe in courage, breathe out tension.',
      'Pause and look within; you have the power.',
      'Frustration is temporary.',
      'Let your thoughts settle; clarity follows.',
      'Respond with wisdom, not rage.'
    ],
    neutral: [
      'A steady mind paves a clearer path.',
      'Calm waters run deep with insight.',
      'Embrace the peace within.',
      'Neutrality helps you truly listen.',
      'Balance is beautiful.',
      'In stillness lies your inner strength.',
      'Neutrality can seed great understanding.',
      'Stay centered and let life flow.'
    ]
  };

  const moodMap = {
    happy: 'MD01',
    sad: 'MD02',
    angry: 'MD03',
    neutral: 'MD04'
  };

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    currentUserID = user.uid;
    loadUserInfo(user);
  });

  moodCards.forEach((card) => {
    card.addEventListener('click', () => {
      moodCards.forEach(m => m.classList.remove('selected'));
      card.classList.add('selected');
      selectedMood = card.getAttribute('data-mood');
    });
  });

  submitMoodBtn.addEventListener('click', () => {
    if (!selectedMood) {
      alert('Please select a mood first!');
      return;
    }
    const moodCatID     = moodMap[selectedMood] || 'MD00';
    const moodIntensity = 5;

    // Example endpoint => adjust to your real server
    fetch('http://127.0.0.1:5500/save_mood', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userID: currentUserID,
        moodCategoryID: moodCatID,
        moodIntensity
      })
    })
      .then(res => res.json())
      .then((data) => {
        if (data.success) {
          showMotivation(selectedMood);
          setTimeout(() => {
            window.location.href = 'suggestion_food.html';
          }, 3000);
        } else {
          alert('Failed to save mood: ' + data.error);
        }
      })
      .catch((err) => {
        console.error('Fetch /save_mood error:', err);
        alert('Unable to reach /save_mood');
      });
  });

  function showMotivation(moodKey) {
    const quotes = moodQuotesMap[moodKey] || ['Keep going! You got this.'];
    const randIndex = Math.floor(Math.random() * quotes.length);
    if (motivationalQuote) {
      motivationalQuote.textContent = quotes[randIndex];
    }
    if (motivationalOverlay) {
      motivationalOverlay.classList.add('show-overlay');
    }
    launchConfetti();
    setTimeout(() => {
      motivationalOverlay?.classList.remove('show-overlay');
    }, 3000);
  }
}

/***************************************************************
 * ========== SECTION K: MAIN PAGE => "start" => add_mood ======
 ***************************************************************/
const startBtn = $id('startBtn');
if (startBtn) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
    } else {
      loadUserInfo(user);
    }
  });
  startBtn.addEventListener('click', () => {
    window.location.href = 'add_mood.html';
  });
}

/***************************************************************
 * ========== SECTION L: MOOD CARDS PAGE (History) =============
 ***************************************************************/
if ($id('moodCardsRow')) {
  const moodCardsRow = $id('moodCardsRow');
  const noEntriesMsg = $id('noEntriesMessage');

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    loadUserInfo(user);
    loadMoodCards(user.uid);
  });

  async function loadMoodCards(userId) {
    try {
      // Adjust endpoint
      const resp = await fetch(`/moodentry?userId=${encodeURIComponent(userId)}`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      const data = await resp.json();
      if (!data || !data.length) {
        noEntriesMsg.style.display = 'block';
        moodCardsRow.style.display = 'none';
        return;
      }
      const userEntries = data.filter(e => e.userId === userId);
      if (!userEntries.length) {
        noEntriesMsg.style.display = 'block';
        moodCardsRow.style.display = 'none';
        return;
      }

      noEntriesMsg.style.display = 'none';
      moodCardsRow.style.display = 'flex';
      moodCardsRow.innerHTML = '';

      userEntries.forEach((entry) => {
        const dateLabel = entry.dateLabel || '---';
        const timeLabel = entry.timeLabel || '';
        const moodCode  = entry.mood || 'MD00';

        const moodText       = getMoodText(moodCode);
        const moodColorClass = getMoodColorClass(moodCode);
        const moodIconClass  = getMoodIconClass(moodCode);

        const cardDiv = document.createElement('div');
        cardDiv.classList.add('mood-card', moodColorClass);
        cardDiv.innerHTML = `
          <div class="mood-date">
            <span class="mood-day">${dateLabel} ${timeLabel}</span>
          </div>
          <div class="mood-summary-title">MOOD Summary</div>
          <div class="mood-icon-text">
            <i class="fas ${moodIconClass}"></i>
            <span class="mood-text">${moodText}</span>
          </div>
        `;
        moodCardsRow.appendChild(cardDiv);
      });
    } catch (err) {
      console.error('Error fetching mood cards:', err);
      alert('Could not load mood entries.');
    }
  }

  function getMoodText(moodCode) {
    switch ((moodCode || '').toUpperCase()) {
      case '1':
      case 'MD01': return 'HAPPY';
      case '2':
      case 'MD02': return 'SAD';
      case '3':
      case 'MD03': return 'ANGRY';
      case '4':
      case 'MD04': return 'NEUTRAL';
      default:     return 'UNKNOWN';
    }
  }
  function getMoodColorClass(moodCode) {
    switch ((moodCode || '').toUpperCase()) {
      case '1':
      case 'MD01': return 'card-happy';
      case '2':
      case 'MD02': return 'card-sad';
      case '3':
      case 'MD03': return 'card-angry';
      case '4':
      case 'MD04': return 'card-neutral';
      default:     return 'card-default';
    }
  }
  function getMoodIconClass(moodCode) {
    switch ((moodCode || '').toUpperCase()) {
      case '1':
      case 'MD01': return 'fa-smile-beam';
      case '2':
      case 'MD02': return 'fa-sad-tear';
      case '3':
      case 'MD03': return 'fa-tired';
      case '4':
      case 'MD04': return 'fa-laugh-beam';
      default:     return 'fa-question-circle';
    }
  }
}

/***************************************************************
 * ========== SECTION M: OUR MENU PAGE (Search & Display) ======
 ***************************************************************/
if ($id('menuCardsRow')) {
  const menuCardsRow    = $id('menuCardsRow');
  const menuSearchInput = $id('menuSearchInput');
  let allFoodItems      = [];

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    loadUserInfo(user);
    loadMenuItems();
  });

  async function loadMenuItems() {
    try {
      const resp = await fetch('/ourmenu');
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      const data = await resp.json();
      if (!data || !data.length) {
        menuCardsRow.innerHTML = '<p>No items found in our menu.</p>';
        return;
      }

      // Example local images
      allFoodItems = data.map(item => ({
        ...item,
        imageURL: `/images/${item.FoodID}.jpg`
      }));
      renderMenu(allFoodItems);
    } catch (err) {
      console.error('Error loading menu items:', err);
      menuCardsRow.innerHTML = `<p>Error: ${err.message}</p>`;
    }
  }

  function renderMenu(foodArray) {
    menuCardsRow.innerHTML = '';
    foodArray.forEach(item => {
      const { FoodID, FoodName, imageURL } = item;
      const card = document.createElement('div');
      card.classList.add('menu-card');
      card.innerHTML = `
        <img src="${imageURL}" alt="${FoodName}" class="menu-card-img" />
        <div class="menu-card-body">
          <p class="menu-foodid">ID: ${FoodID}</p>
          <h3 class="menu-foodname">${FoodName}</h3>
        </div>
      `;
      menuCardsRow.appendChild(card);
    });
  }

  menuSearchInput?.addEventListener('input', () => {
    const query = menuSearchInput.value.toLowerCase().trim();
    const filtered = allFoodItems.filter(item =>
      item.FoodName.toLowerCase().includes(query) ||
      item.FoodID.toLowerCase().includes(query)
    );
    renderMenu(filtered);
  });
}

/***************************************************************
 * ========== SECTION N: PROFILE PAGE (View/Update/Delete) =====
 ***************************************************************/
if (document.querySelector('.profile-page')) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    // Load name/photo in the header
    await loadUserInfo(user);

    // Now init the Profile form
    initProfileForm(user);
  });

  async function initProfileForm(user) {
    const profileForm     = $id('profileForm');
    const deleteAccountBtn= $id('deleteAccountBtn');
    if (!profileForm) return;

    // Pre-fill form from Firestore
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const docSnap    = await getDoc(userDocRef);
      if (docSnap.exists()) {
        const docData = docSnap.data();
        if (docData.healthData) {
          const { allergies=[], birthday, weight, height, bloodType } = docData.healthData;

          // Pre-check the allergies
          allergies.forEach(val => {
            for (let i = 0; i < 14; i++) {
              const cb = $id(`allergy-${i}`);
              if (cb && cb.value === val) cb.checked = true;
            }
          });
          if (birthday) $id('birthday').value = birthday;
          if (weight)   $id('weight').value   = weight;
          if (height)   $id('height').value   = height;
          if (bloodType)$id('bloodType').value= bloodType;
        }
      }
    } catch (err) {
      console.error('Error loading user doc:', err);
    }

    // On Save Changes
    profileForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      try {
        const selectedAllergies = [];
        for (let i = 0; i < 14; i++) {
          const cb = $id(`allergy-${i}`);
          if (cb && cb.checked) {
            selectedAllergies.push(cb.value);
          }
        }
        const birthday  = $id('birthday').value;
        const weight    = parseInt($id('weight').value, 10) || 0;
        const height    = parseInt($id('height').value, 10) || 0;
        const bloodType = $id('bloodType').value || 'Unknown';

        await setDoc(
          doc(db, 'users', user.uid),
          {
            healthData: {
              allergies: selectedAllergies,
              birthday,
              weight,
              height,
              bloodType
            },
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
        alert('Profile changes saved!');
      } catch (err) {
        console.error('Error saving profile data:', err);
        alert('Error saving profile data.');
      }
    });

    // On Delete Account
    deleteAccountBtn?.addEventListener('click', async () => {
      const sure = confirm('Are you sure you want to delete your account? This cannot be undone!');
      if (!sure) return;
      try {
        await deleteDoc(doc(db, 'users', user.uid));
        await deleteUser(user);
        alert('Your account has been deleted.');
        window.location.href = 'login.html';
      } catch (err) {
        console.error('Error deleting account:', err);
        alert('Could not delete account. You might need to log in again recently.');
      }
    });
  }
}

/***************************************************************
 * ========== SECTION O: SUGGESTION FOOD PAGE ===================
 ***************************************************************/
if ($id('foodCardsRow') && $id('doneBtn')) {
  const foodCardsRow = $id('foodCardsRow');
  const doneBtn      = $id('doneBtn');

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    loadUserInfo(user);
    loadFoodSuggestions(user.uid);
  });

  doneBtn?.addEventListener('click', () => {
    alert('Thanks! Enjoy your meal suggestions.');
  });

  async function loadFoodSuggestions(userId) {
    try {
      const resp = await fetch(`/foodsuggestion?userId=${encodeURIComponent(userId)}`);
      if (!resp.ok) throw new Error(`Failed to fetch suggestions: ${resp.statusText}`);
      const suggestions = await resp.json();
      foodCardsRow.innerHTML = '';
  
      if (!Array.isArray(suggestions) || !suggestions.length) {
        foodCardsRow.innerHTML = '<p>No suggestions found.</p>';
        return;
      }
  
      // Render ALL suggestions
      //For show3
      renderSuggestions(suggestions.slice(0,3));

      // For Show all
      //renderSuggestions(suggestions);
  
    } catch (error) {
      console.error('Error loading suggestions:', error);
      foodCardsRow.innerHTML = `<p>Error: ${error.message}</p>`;
    }
  }

  function renderSuggestions(items) {
    foodCardsRow.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('div');
      card.classList.add('food-card');
      const imageUrl = item.ImageURL || 'photo/default_food.png';
      const foodName = item.FoodName || 'Unknown Food';

      card.innerHTML = `
        <img src="${imageUrl}" alt="${foodName}" class="food-card-img" />
        <h3 class="food-card-title">${foodName}</h3>
        <p><strong>Food ID:</strong> ${item.FoodID}</p>
        <div class="food-card-buttons">
          <button class="select-btn">Select</button>
        </div>
      `;
      card.querySelector('.select-btn').addEventListener('click', () => {
        window.location.href = `ingredients.html?foodId=${item.FoodID}&suggestionId=${item.SuggestionID}`;
      });
      foodCardsRow.appendChild(card);
    });
  }
}

/***************************************************************
 * ========== SECTION P: SUMMARY PAGE (Mood Chart, Calendar) ===
 ***************************************************************/
if ($id('moodChart')) {
  let moodChart        = null;
  let moodByDate       = {};
  let calendarDispDate = new Date();

  const rangeSelect    = $id('rangeSelect');
  const rangeBtn       = $id('rangeBtn');
  const totalMoodsEl   = $id('totalMoods');
  const currentDTEl    = $id('currentDateTime');
  const calendarTitleEl= $id('calendarTitle');
  const smallCalTable  = $id('smallCalendarTable');
  const prevMonthBtn   = $id('prevMonthBtn');
  const nextMonthBtn   = $id('nextMonthBtn');

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    loadUserInfo(user);
    updateDateTime();
    setInterval(updateDateTime, 60000); // update every minute

    // default: weekly summary
    fetchSummary('weekly', user.uid);

    // also load all mood entries for mini calendar
    await loadAllMoodEntries(user.uid);
    buildSmallCalendar();
  });

  rangeBtn?.addEventListener('click', () => {
    if (!auth.currentUser) return;
    fetchSummary(rangeSelect.value, auth.currentUser.uid);
  });

  async function fetchSummary(range, userId) {
    try {
      const url  = `/moodsummary?range=${encodeURIComponent(range)}&userId=${encodeURIComponent(userId)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
      const data = await resp.json();
      const total = data.total || 0;
      if (totalMoodsEl) {
        totalMoodsEl.textContent = total;
      }
      const raw = data.counts || {};
      const labels = Object.keys(raw).map(code => getMoodLabel(code));
      const values = Object.keys(raw).map(code => raw[code]);
      updateChart(labels, values);
    } catch (err) {
      console.error('Error fetching summary:', err);
      if (totalMoodsEl) totalMoodsEl.textContent = '0';
      moodChart?.destroy();
    }
  }

  function getMoodLabel(code) {
    switch ((code || '').toUpperCase()) {
      case 'MD01': return 'Happy';
      case 'MD02': return 'Sad';
      case 'MD03': return 'Angry';
      case 'MD04': return 'Neutral';
      default:     return 'Unknown';
    }
  }
  function getMoodColor(label) {
    switch (label.toUpperCase()) {
      case 'HAPPY':   return '#fff9b2';
      case 'SAD':     return '#684b79';
      case 'ANGRY':   return '#ec2727';
      case 'NEUTRAL': return '#b2efdc';
      default:        return '#ccc';
    }
  }

  function updateChart(labels, values) {
    if (moodChart) moodChart.destroy();
    const backgroundColors = labels.map(l => getMoodColor(l));
    // If using Chart.js:
    moodChart = new Chart($id('moodChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Count of Each Mood',
          data: values,
          backgroundColor: backgroundColors
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 }
          }
        }
      }
    });
  }

  async function loadAllMoodEntries(userId) {
    try {
      const resp = await fetch(`/moodentry?userId=${encodeURIComponent(userId)}`);
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
      const data = await resp.json();
      moodByDate = {};
      const currentYear = new Date().getFullYear();

      data.forEach(entry => {
        const splitted = (entry.dateLabel || '').split(' ');
        const moodCode = entry.mood || '';
        const moodLabel= getMoodLabel(moodCode);

        // e.g. "Mar 12" => parse
        if (splitted.length === 2) {
          const monthMap = {
            Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
            Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
          };
          const mm = monthMap[splitted[0]] || 1;
          const dd = parseInt(splitted[1], 10);
          const dateKey = `${currentYear}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
          if (!moodByDate[dateKey]) {
            moodByDate[dateKey] = [];
          }
          moodByDate[dateKey].push(moodLabel);
        }
      });
    } catch (err) {
      console.error('Error loading user mood entries:', err);
    }
  }

  function buildSmallCalendar() {
    if (!smallCalTable) return;
    const today       = new Date();
    const dispYear    = calendarDispDate.getFullYear();
    const dispMonth   = calendarDispDate.getMonth();
    const monthNames  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (calendarTitleEl) {
      calendarTitleEl.textContent = `${monthNames[dispMonth]} ${dispYear}`;
    }

    const daysOfWeek  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const firstOfMonth= new Date(dispYear, dispMonth, 1);
    const firstDayJS  = firstOfMonth.getDay(); // Sunday=0
    const offset      = (firstDayJS + 6) % 7;  // shift Monday=0
    const lastOfMonth = new Date(dispYear, dispMonth+1, 0);
    const numDays     = lastOfMonth.getDate();

    let thead = '<thead><tr>';
    daysOfWeek.forEach(d => thead += `<th>${d}</th>`);
    thead += '</tr></thead>';

    let tbody = '<tbody><tr>';
    // blank cells
    for (let i = 0; i < offset; i++) {
      tbody += '<td></td>';
    }

    for (let d = 1; d <= numDays; d++) {
      const colIndex = (offset + (d-1)) % 7;
      const isToday  = (d === today.getDate() && dispMonth === today.getMonth() && dispYear === today.getFullYear());
      const cellClass= isToday ? 'small-calendar-current-day' : '';
      const dateKey  = `${dispYear}-${String(dispMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const moods    = moodByDate[dateKey] || [];
      const iconsHtml= moods.map(lbl => `<span class="small-calendar-mood-icon">${moodToIcon(lbl)}</span>`).join('');

      tbody += `
        <td class="${cellClass}">
          <span class="small-calendar-date">${d}</span>
          ${iconsHtml}
        </td>
      `;
      if (colIndex === 6) {
        tbody += '</tr><tr>';
      }
    }

    const leftover = 7 - ((offset + numDays) % 7);
    if (leftover < 7) {
      for (let i = 0; i < leftover; i++) {
        tbody += '<td></td>';
      }
    }
    tbody += '</tr></tbody>';
    smallCalTable.innerHTML = thead + tbody;
  }

  function moodToIcon(moodLabel) {
    switch (moodLabel.toUpperCase()) {
      case 'HAPPY':   return '😊';
      case 'SAD':     return '😢';
      case 'ANGRY':   return '😡';
      case 'NEUTRAL': return '😐';
      default:        return '❓';
    }
  }

  function updateDateTime() {
    if (!currentDTEl) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    currentDTEl.textContent = `${dateStr} - ${timeStr}`;
  }

  prevMonthBtn?.addEventListener('click', () => {
    calendarDispDate.setMonth(calendarDispDate.getMonth() - 1);
    buildSmallCalendar();
  });
  nextMonthBtn?.addEventListener('click', () => {
    calendarDispDate.setMonth(calendarDispDate.getMonth() + 1);
    buildSmallCalendar();
  });
}

/***************************************************************
 * ========== SECTION Q: WELCOME PAGE ===========================
 ***************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.welcome-page')) {
    const welcomeStartBtn = $id('welcomeStartBtn');
    welcomeStartBtn?.addEventListener('click', () => {
      window.location.href = 'main.html';
    });
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = 'login.html';
        return;
      }
      const welcomePhoto   = $id('welcomePhoto');
      const welcomeName    = $id('welcomeName');
      const welcomeEmail   = $id('welcomeEmail');
      const welcomeDetails = $id('welcomeDetails');

      if (welcomePhoto) welcomePhoto.src = user.photoURL || 'photo/foodmood_logo_icon_copy-removebg-preview.png';
      if (welcomeName)  welcomeName.textContent = user.displayName || user.email || 'My Account';
      if (welcomeEmail) welcomeEmail.textContent = user.email || 'No email';

      try {
        const docSnap = await getDoc(doc(db, 'users', user.uid));
        if (docSnap.exists()) {
          const userData = docSnap.data();
          if (userData.healthData) {
            const { allergies=[], weight, height, bloodType, birthday } = userData.healthData;
            let ageString = 'Unknown';
            if (birthday) {
              const bd = new Date(birthday);
              if (!isNaN(bd)) {
                const today = new Date();
                let age  = today.getFullYear() - bd.getFullYear();
                const mDiff = today.getMonth() - bd.getMonth();
                const dDiff = today.getDate() - bd.getDate();
                if (mDiff < 0 || (mDiff===0 && dDiff<0)) age--;
                ageString = `${age} yrs`;
              }
            }
            const allergyStr = allergies.length ? allergies.join(', ') : 'No allergies';
            const details = `${ageString} | ${weight||'?'} kg | ${height||'?'} cm | Blood Type: ${bloodType||'?'} | ${allergyStr}`;
            if (welcomeDetails) welcomeDetails.textContent = details;
          } else {
            if (welcomeDetails) welcomeDetails.textContent = 'No healthData found.';
          }
        } else {
          if (welcomeDetails) welcomeDetails.textContent = 'User doc does not exist.';
        }
      } catch (err) {
        console.error('Error fetching user doc:', err);
        if (welcomeDetails) welcomeDetails.textContent = 'Error loading data.';
      }
    });
  }
});

/***************************************************************
 * ========== SECTION R: INGREDIENTS PAGE =======================
 ***************************************************************/
if ($id('ingredientsList')) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    loadUserInfo(user);

    const params      = new URLSearchParams(window.location.search);
    const foodIdParam = params.get('foodId');
    const suggIdParam = params.get('suggestionId');

    const backBtn      = $id('backBtn');
    const markEatenBtn = $id('markEatenBtn');

    backBtn?.addEventListener('click', () => {
      const backUrl = suggIdParam
        ? `suggestion_food.html?suggestionId=${encodeURIComponent(suggIdParam)}`
        : 'suggestion_food.html';
      window.location.href = backUrl;
    });

    if (!foodIdParam) {
      $id('ingredientsList').innerHTML = '<p>No food selected.</p>';
    } else {
      loadFoodDetails(foodIdParam);
    }

    markEatenBtn?.addEventListener('click', async () => {
      $id('markEatenSuccess').style.display = 'none';
      const confettiWrapper = $id('confettiWrapper');
      if (confettiWrapper) confettiWrapper.innerHTML = '';

      try {
        if (!suggIdParam) {
          throw new Error("No 'suggestionId' found — cannot mark as eaten!");
        }
        const resp = await fetch('/updateEatenFlag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId: suggIdParam })
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(errText);
        }
        $id('markEatenSuccess').style.display = 'block';
        launchConfetti();
        setTimeout(() => {
          window.location.href = `Eaten Page.html?foodId=${foodIdParam}&suggestionId=${suggIdParam}`;
        }, 2000);
      } catch (err) {
        console.error('Error marking eaten:', err);
        alert('Unable to mark as eaten. Error: ' + err.message);
      }
    });
  });

  async function loadFoodDetails(foodId) {
    try {
      const resp = await fetch(`/foodingredient?foodId=${encodeURIComponent(foodId)}`);
      if (!resp.ok) throw new Error(`Failed to fetch ingredients: ${resp.status}`);
      const data = await resp.json();
      const { food, ingredients } = data;
      if (!food) {
        $id('foodNameTitle').textContent = `Food #${foodId} not found`;
        return;
      }
      $id('foodNameTitle').textContent = food.FoodName || `Food #${foodId}`;
      $id('foodDesc').textContent      = `Mood: ${food.MoodCategoryID||'N/A'}, BMI: ${food.BMI||'N/A'}, Age Range: ${food.Age_Range||'N/A'}`;

      const foodImage  = $id('foodImage');
      const localImage = `/images/${foodId}.jpg`;
      const defaultImg = 'photo/default_food.png';
      if (foodImage) {
        foodImage.src = localImage;
        foodImage.onerror = () => {
          foodImage.src = defaultImg;
        };
      }

      const ingList = $id('ingredientsList');
      if (!Array.isArray(ingredients) || !ingredients.length) {
        ingList.innerHTML = '<p>No ingredients found.</p>';
        return;
      }
      ingList.innerHTML = '';
      ingredients.forEach(ing => {
        const card = document.createElement('div');
        card.classList.add('ingredient-card');
        card.innerHTML = `
          <h3 class="ingredient-name">${ing.IngredientName||'Unknown'}</h3>
          <div class="ingredient-info">
            <strong>Allergy:</strong> ${ing.Allergy||'-'}<br/>
            <strong>Blood Type:</strong> ${ing.BloodType||'Any'}<br/>
          </div>
        `;
        ingList.appendChild(card);
      });
    } catch (err) {
      console.error('Error loading food details:', err);
      $id('ingredientsList').innerHTML = '<p>Error loading ingredients.</p>';
    }
  }
}

/***************************************************************
 * ========== SECTION S: EATEN PAGE => USER MOOD FEEDBACK ======
 ***************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.eaten-page')) return;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    const uid       = user.uid;
    const params    = new URLSearchParams(window.location.search);
    const foodId    = params.get('foodId');
    const feedback  = $id('feedbackMessage');

    const moodBtns = {
      Happy:   $id('happyBtn'),
      Sad:     $id('sadBtn'),
      Angry:   $id('angryBtn'),
      Neutral: $id('neutralBtn')
    };

    if (foodId) {
      fetchFoodInfo(foodId);
    }

    Object.entries(moodBtns).forEach(([mood, btn]) => {
      if (btn) {
        btn.addEventListener('click', () => submitMoodFeedback(mood));
      }
    });

    async function fetchFoodInfo(fid) {
      try {
        const res = await fetch(`/food_eaten_info?foodId=${encodeURIComponent(fid)}`);
        if (!res.ok) throw new Error('Failed to fetch food info');
        const data = await res.json();
        $id('foodName').textContent = data.FoodName || 'Unknown';
        $id('foodImage').src        = data.ImageURL || 'photo/default_food.png';
      } catch (err) {
        console.error('Error loading eaten food data:', err);
      }
    }

    async function submitMoodFeedback(feeling) {
      feedback.textContent = 'Sending feedback...';
      try {
        const resp = await fetch('/store_eaten_feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, foodId, feeling })
        });
        if (!resp.ok) throw new Error('Error saving feedback');
        const result = await resp.json();
        if (!result.success) {
          feedback.textContent = 'Failed to save feedback: ' + (result.error || 'Unknown');
          return;
        }
        feedback.textContent = `Thank you! You feel "${feeling}" after eating.`;
        launchConfetti();
        setTimeout(() => {
          window.location.href = 'main.html';
        }, 2000);
      } catch (err) {
        feedback.textContent = 'Error: ' + err.message;
        console.error('Feedback error:', err);
      }
    }
  });
});

/***************************************************************
 * ========== SECTION T: NOTIFICATION SCHEDULING ===============
 ***************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  const notifyForm = $id('notifyForm');
  if (!notifyForm) return;

  const feedbackMsg   = $id('feedbackMessage');
  const emailInput    = $id('emailInput');
  const datetimeInput = $id('datetimeInput');
  const freqSelect    = $id('freqInput');
  let currentUser     = null;

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      loadUserInfo(user);

      // Pre-fill from localStorage
      const storedEmail = localStorage.getItem(`notificationEmail_${user.uid}`);
      const storedDate  = localStorage.getItem(`notificationDate_${user.uid}`);
      const storedFreq  = localStorage.getItem(`notificationFrequency_${user.uid}`);

      const urlParams   = new URLSearchParams(window.location.search);
      const queryDate   = urlParams.get('datetime');
      const queryFreq   = urlParams.get('frequency') || 'once';

      emailInput.value = storedEmail || user.email || '';
      if (queryDate) {
        datetimeInput.value = queryDate;
        localStorage.setItem(`notificationDate_${user.uid}`, queryDate);
      } else if (storedDate) {
        datetimeInput.value = storedDate;
      }
      if (queryFreq) {
        freqSelect.value = queryFreq;
        localStorage.setItem(`notificationFrequency_${user.uid}`, queryFreq);
      } else if (storedFreq) {
        freqSelect.value = storedFreq;
      }
    } else {
      const allowedPages = ['/login.html','/otp.html','/forgot-password.html','/phone-login.html'];
      if (!allowedPages.includes(window.location.pathname)) {
        window.location.href = 'login.html';
      }
    }
  });

  notifyForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!currentUser) {
      setFeedback('You must be logged in to schedule a reminder.', 'red');
      return;
    }
    const emailValue   = emailInput.value.trim();
    const dateTimeVal  = datetimeInput.value.trim();
    const freqValue    = freqSelect.value.trim();

    if (!emailValue) {
      setFeedback('Please enter your email address.', 'red');
      return;
    }
    if (!dateTimeVal) {
      setFeedback('Please select a valid date/time.', 'red');
      return;
    }

    localStorage.setItem(`notificationDate_${currentUser.uid}`, dateTimeVal);
    localStorage.setItem(`notificationFrequency_${currentUser.uid}`, freqValue);

    scheduleReminder(emailValue, dateTimeVal, freqValue, currentUser.uid);
  });

  async function scheduleReminder(email, dateTime, frequency, uid) {
    try {
      const payload = { email, reminderDate: dateTime, frequency, uid };
      // Adjust your actual endpoint
      const resp = await fetch('/schedule_reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (data.success) {
        setFeedback(`Reminder scheduled for ${dateTime}. Frequency: ${frequency}`, 'green');
        notifyForm.reset();
        localStorage.setItem(`notificationEmail_${uid}`, email);
      } else {
        setFeedback(`Error scheduling reminder: ${data.error}`, 'red');
      }
    } catch (err) {
      setFeedback('Request error: ' + err.message, 'red');
    }
  }

  function setFeedback(msg, color) {
    feedbackMsg.textContent = msg;
    feedbackMsg.style.color = color;
  }
});

/***************************************************************
 * ========== SECTION U: REPORT PAGE => MOOD BEFORE/AFTER ======
 ***************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.report-page')) return;

  const historyTableBody = document.querySelector('#historyTable tbody');
  const range7Btn        = $id('range7Btn');
  const range30Btn       = $id('range30Btn');
  const downloadPdfBtn   = $id('downloadPdfBtn');
  let currentUser        = null;
  let moodLineChart      = null;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    currentUser = user;
    loadUserInfo(user);

    // Default: last 7 days
    const { start, end } = getDateRange(7);
    fetchReportData(user.uid, start, end);

    // Range button events
    range7Btn?.addEventListener('click',  () => handleRangeClick(7));
    range30Btn?.addEventListener('click', () => handleRangeClick(30));
  });

  function getDateRange(numDays) {
    const now = new Date();
    // End = "today"
    const end = [
      now.getFullYear(),
      String(now.getMonth()+1).padStart(2,'0'),
      String(now.getDate()).padStart(2,'0')
    ].join('-');

    // Start = "today - (numDays-1)"
    const startObj = new Date(now.getTime() - (numDays - 1) * 86400000);
    const start = [
      startObj.getFullYear(),
      String(startObj.getMonth()+1).padStart(2,'0'),
      String(startObj.getDate()).padStart(2,'0')
    ].join('-');

    return { start, end };
  }

  function handleRangeClick(numDays) {
    if (!currentUser) return;
    const { start, end } = getDateRange(numDays);
    fetchReportData(currentUser.uid, start, end);
  }

  async function fetchReportData(uid, start, end) {
    try {
      // Adjust to your actual endpoint
      const url  = `/report_data?userId=${encodeURIComponent(uid)}&start=${start}&end=${end}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      renderReport(data);
    } catch (err) {
      console.error('Failed to load report data:', err);
      alert('Failed to load data.');
    }
  }

  function renderReport(data) {
    historyTableBody.innerHTML = '';
    data.tableData.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img src="${item.foodImage}" style="width:50px" /></td>
        <td>${item.foodName}</td>
        <td>${item.dateTime}</td>
        <td>${item.moodBefore}</td>
        <td>${item.moodAfter}</td>
      `;
      historyTableBody.appendChild(tr);
    });

    // Convert arrays to maps
    const moodBarData      = data.moodBarData      || [];
    const moodAfterBarData = data.moodAfterBarData || [];

    const beforeMap = {};
    moodBarData.forEach(obj => { beforeMap[obj.label] = obj.count; });
    const afterMap = {};
    moodAfterBarData.forEach(obj => { afterMap[obj.label]  = obj.count; });

    const xLabels   = ['Happy','Sad','Angry','Neutral'];
    const beforeData= xLabels.map(lbl => beforeMap[lbl] || 0);
    const afterData = xLabels.map(lbl => afterMap[lbl]  || 0);

    const ctx = $id('moodCompareChart');
    if (moodLineChart) {
      moodLineChart.destroy();
    }
    // Example line chart with Chart.js
    moodLineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['😀 Happy','😢 Sad','😠 Angry','😐 Neutral'],
        datasets: [
          {
            label: 'Mood Before Meal',
            data: beforeData,
            borderColor: '#ff6384',
            backgroundColor: '#ff638420',
            pointBackgroundColor: '#ff6384',
            pointBorderColor: '#fff',
            pointRadius: 6,
            pointStyle: 'circle',
            borderWidth: 3,
            fill: true,
            tension: 0.3
          },
          {
            label: 'Mood After Meal',
            data: afterData,
            borderColor: '#36a2eb',
            backgroundColor: '#36a2eb20',
            pointBackgroundColor: '#36a2eb',
            pointBorderColor: '#fff',
            pointRadius: 6,
            pointStyle: 'rect',
            borderWidth: 3,
            borderDash: [6, 3],
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Mood Before vs After Meals',
            font: { size: 18 }
          },
          legend: {
            labels: { font: { size: 14 } }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        scales: {
          x: {
            title: { display: true, text: 'Mood Type' }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Number of Meals' },
            ticks: { stepSize: 1, precision: 0 }
          }
        }
      }
    });
  }

  // PDF Export if you have jsPDF
  const { jsPDF } = window.jspdf || {};
  if (downloadPdfBtn && jsPDF) {
    downloadPdfBtn.addEventListener('click', () => {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('FoodMood Report', 14, 20);

      let yPos = 30;
      doc.setFontSize(12);
      doc.text(`Date of Report: ${new Date().toLocaleString()}`, 14, yPos);
      yPos += 10;
      doc.text('Consumed Meals:', 14, yPos);
      yPos += 10;

      const rows = document.querySelectorAll('#historyTable tbody tr');
      rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        const lineArr = Array.from(cols).map((td, idx) =>
          (idx === 0) ? '[Im`g]' : td.innerText
        );
        const line = lineArr.join(' | ');
        doc.text(line, 14, yPos);
        yPos += 6;
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
        }
      });

      yPos += 10;
      const moodCompareCanvas  = $id('moodCompareChart');
      const moodCompareDataURL = moodCompareCanvas.toDataURL('image/png');
      doc.addImage(moodCompareDataURL, 'PNG', 15, yPos, 180, 100);
      doc.save('FoodMood_Report.pdf');
    });
  }
});

/***************************************************************
 * ========== SECTION V: SUGGESTION HISTORY PAGE ===============
 ***************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('.history-sugg-page')) return;

  const suggTableBody = document.querySelector('#suggHistoryTable tbody');
  const noHistoryMsg  = $id('noHistoryMessage');

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    loadUserInfo(user);
    await loadSuggestionHistory(user.uid);
  });

  async function loadSuggestionHistory(userId) {
    try {
      const response = await fetch(`/foodsugg_history?userId=${encodeURIComponent(userId)}`);
      if (!response.ok) throw new Error(`Server responded with status ${response.status}`);

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        noHistoryMsg.style.display = 'block';
        return;
      }

      noHistoryMsg.style.display = 'none';
      suggTableBody.innerHTML = '';

      data.forEach(item => {
        const tr = document.createElement('tr');
        // Use the raw date string from the DB instead of converting to local time
        const dateStr = item.SuggestedDate || 'Unknown Date';
        const status  = item.EatenFlag ? 'Eaten' : 'Not Eaten';

        tr.innerHTML = `
          <td>${item.FoodName || 'Unknown'}</td>
          <td>
            <img 
              src="${item.ImageURL || 'photo/default_food.png'}"
              alt="Food"
              style="width:60px; height:60px;" 
            />
          </td>
          <td>${item.MoodName || item.MoodCategoryID || 'Mood'}</td>
          <td>${dateStr}</td>
          <td>${status}</td>
          <td>
            <button
              class="view-btn"
              data-foodid="${item.FoodID}"
              data-suggestionid="${item.SuggestionID}"
            >
              Select
            </button>
          </td>
        `;
        suggTableBody.appendChild(tr);
      });

      // Click event to "Select" a suggestion and go to ingredients page
      suggTableBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('view-btn')) {
          const foodId       = e.target.getAttribute('data-foodid');
          const suggestionId = e.target.getAttribute('data-suggestionid');
          window.location.href = `ingredients.html?foodId=${foodId}&suggestionId=${suggestionId}`;
        }
      });
    } catch (err) {
      console.error('Failed to load suggestion history:', err);
      alert(`Error: ${err.message}`);
    }
  }
});