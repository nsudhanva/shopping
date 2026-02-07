import { initializeApp } from "firebase/app";
import { browserLocalPersistence, GoogleAuthProvider, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDjK2UwzJpl_f-PhTCTHz_EENkypKiI7Jg",
  authDomain: "sudhanva-personal.firebaseapp.com",
  projectId: "sudhanva-personal",
  storageBucket: "sudhanva-personal.firebasestorage.app",
  messagingSenderId: "677321535908",
  appId: "1:677321535908:web:1e074c401cb1503df75131",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

void setPersistence(auth, browserLocalPersistence);
