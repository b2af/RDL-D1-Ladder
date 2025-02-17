import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    sendEmailVerification,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, 
    setDoc,
    collection 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const username = document.getElementById('register-username').value;
    const verificationAnswer = document.getElementById('verification-answer').value.toLowerCase();

    // Check the verification answer
    const validAnswers = ['purple', 'magenta'];
    if (!validAnswers.includes(verificationAnswer)) {
        document.getElementById('register-error').textContent = 'Incorrect answer to verification question';
        return;
    }

    try {
        // Create user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Send verification email
        await sendEmailVerification(user);

        // Add user to Firestore using new modular syntax
        const userDocRef = doc(db, "players", user.uid);
        await setDoc(userDocRef, {
            username: username,
            email: email,
            eloRating: 1200,
            position: Number.MAX_SAFE_INTEGER
        });

        // Show success message
        document.getElementById('register-error').innerHTML = `
            <div class="success-message">
                Registration successful! Please check your email to verify your account.
                You will be redirected to login in 3 seconds.
            </div>`;

        // Redirect to login after 3 seconds
        setTimeout(() => {
            document.getElementById('register-container').style.display = 'none';
            document.getElementById('login-container').style.display = 'block';
        }, 3000);

    } catch (error) {
        document.getElementById('register-error').textContent = error.message;
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
    } catch (error) {
        document.getElementById('login-error').textContent = error.message;
    }
}

// Function to resend verification email
async function resendVerificationEmail(email) {
    try {
        const user = auth.currentUser;
        if (user) {
            await sendEmailVerification(user);
            document.getElementById('login-error').innerHTML = `
                <div class="success-message">
                    Verification email has been resent. Please check your inbox.
                </div>`;
        }
    } catch (error) {
        document.getElementById('login-error').textContent = error.message;
    }
}

// Make resendVerificationEmail available globally
window.resendVerificationEmail = resendVerificationEmail;

// Register Form Submission
document.getElementById('register-form').addEventListener('submit', handleRegister);

// Login Form Submission
document.getElementById('login-form').addEventListener('submit', handleLogin);

document.addEventListener('DOMContentLoaded', () => {
    // Add form switching handlers
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('register-container').style.display = 'block';
    });

    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-container').style.display = 'none';
        document.getElementById('login-container').style.display = 'block';
    });
});
