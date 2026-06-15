import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import {
    getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, setDoc, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth, signInAnonymously, setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCssepOWIm1JBzKiDKTQ9g5YkD_XahET7Q",
    authDomain: "pin-chat-283e3.firebaseapp.com",
    projectId: "pin-chat-283e3",
    storageBucket: "pin-chat-283e3.firebasestorage.app",
    messagingSenderId: "518329977970",
    appId: "1:518329977970:web:1036c275c9df8cd01446eb",
    measurementId: "G-YG9FWF76SJ"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const loginForm = document.getElementById('login-form');
const chatForm = document.getElementById('chat-form');
const pinInput = document.getElementById('pin-input');
const usernameInput = document.getElementById('username-input');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages-container');
const roomPinDisplay = document.getElementById('room-pin-display');
const memberCountDisplay = document.getElementById('member-count');
const typingIndicator = document.getElementById('typing-indicator');
const leaveBtn = document.getElementById('leave-btn');
const imageInput = document.getElementById('image-input');
const imageUploadBtn = document.getElementById('image-upload-btn');
const imagePreview = document.getElementById('image-preview');
const cancelImageBtn = document.getElementById('cancel-image-btn');
let selectedImageFile = null;

// State
let currentPin = null;
let currentUsername = null;
let currentUser = null;
let typingTimeout = null;
let unsubscribeMessages = null;
let unsubscribeMembers = null;
let unsubscribeTyping = null;

// Auth with Session Persistence (Each tab = New User)
setPersistence(auth, browserSessionPersistence)
    .then(() => {
        return signInAnonymously(auth);
    })
    .then((userCredential) => {
        currentUser = userCredential.user;
        console.log("Signed in anonymously:", currentUser.uid);
    })
    .catch((error) => {
        console.error("Auth Error:", error);
        if (error.code === 'auth/configuration-not-found' || error.code === 'auth/operation-not-allowed') {
            alert("CRITICAL ERROR: Anonymous Authentication is NOT enabled in your Firebase Console.\n\nPlease go to Firebase Console > Build > Authentication > Sign-in method > Enable 'Anonymous'.");
        } else {
            alert("Authentication Error: " + error.message);
        }
    });

// Event Listeners
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    const username = usernameInput.value.trim();

    if (pin && username && currentUser) {
        joinRoom(pin, username);
    } else if (!currentUser) {
        alert("Connecting to service... please wait.");
    }
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (currentPin) {
        if (selectedImageFile) {
            sendImageMessage(message || null);
        } else if (message) {
            sendMessage(message);
        }
    }
});

messageInput.addEventListener('input', () => {
    updateTypingStatus(true);

    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        updateTypingStatus(false);
    }, 1000);
});

leaveBtn.addEventListener('click', () => {
    leaveRoom();
});

imageUploadBtn.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file.');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert('Image must be under 5MB.');
        return;
    }
    selectedImageFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
        imagePreview.querySelector('img').src = ev.target.result;
        imagePreview.classList.add('visible');
    };
    reader.readAsDataURL(file);
});

cancelImageBtn.addEventListener('click', () => {
    selectedImageFile = null;
    imageInput.value = '';
    imagePreview.classList.remove('visible');
});

// Functions
async function joinRoom(pin, username) {
    currentPin = pin;
    currentUsername = username;

    // UI Transition
    loginScreen.classList.remove('active');
    chatScreen.classList.add('active');
    roomPinDisplay.textContent = pin;
    messagesContainer.innerHTML = '';

    // 1. Add User to Room Members
    const memberRef = doc(db, 'rooms', pin, 'members', currentUser.uid);
    await setDoc(memberRef, {
        username: username,
        joinedAt: serverTimestamp()
    });

    // Handle Tab Close / Unload to remove user
    window.addEventListener('beforeunload', () => {
        deleteDoc(memberRef); // Best effort
    });

    // 2. Listen for Messages
    const messagesRef = collection(db, 'rooms', pin, 'messages');
    const qMessages = query(messagesRef, orderBy('timestamp', 'asc'));

    unsubscribeMessages = onSnapshot(qMessages, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                addMessageToUI(change.doc.id, data, data.uid === currentUser.uid);
            }
            if (change.type === "removed") {
                removeMessageFromUI(change.doc.id);
            }
        });
    });

    // 3. Listen for Members (Count)
    const membersRef = collection(db, 'rooms', pin, 'members');
    unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
        const count = snapshot.size;
        memberCountDisplay.textContent = `${count} Member${count !== 1 ? 's' : ''}`;
    });

    // 4. Listen for Typing
    // 4. Listen for Typing
    const typingRef = collection(db, 'rooms', pin, 'typing');
    unsubscribeTyping = onSnapshot(typingRef, (snapshot) => {
        const typers = [];
        snapshot.forEach(doc => {
            // Don't show "You are typing"
            if (doc.id !== currentUser.uid) {
                const data = doc.data();
                if (data && data.username) {
                    typers.push(data.username);
                }
            }
        });

        if (typers.length > 0) {
            typingIndicator.textContent = `${typers.join(', ')} is typing...`;
            typingIndicator.style.opacity = '1';
        } else {
            typingIndicator.textContent = '';
            typingIndicator.style.opacity = '0';
        }
    });

    addSystemMessage(`Joined room: ${pin} as ${username}`);
    messageInput.focus();
}

async function sendMessage(text) {
    messageInput.value = '';
    messageInput.focus();
    updateTypingStatus(false); // Stop typing immediately

    try {
        await addDoc(collection(db, 'rooms', currentPin, 'messages'), {
            text: text,
            sender: currentUsername,
            uid: currentUser.uid,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Error sending message: ", e);
        addSystemMessage("Failed to send message.");
    }
}

async function sendImageMessage(caption) {
    messageInput.value = '';
    updateTypingStatus(false);
    const file = selectedImageFile;
    selectedImageFile = null;
    imageInput.value = '';
    imagePreview.classList.remove('visible');

    try {
        const storageRef = ref(storage, `rooms/${currentPin}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        await addDoc(collection(db, 'rooms', currentPin, 'messages'), {
            type: 'image',
            imageURL: downloadURL,
            caption: caption,
            sender: currentUsername,
            uid: currentUser.uid,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Error sending image: ", e);
        addSystemMessage("Failed to send image.");
    }
}

async function updateTypingStatus(isTyping) {
    if (!currentPin || !currentUser) return;

    const typingDocRef = doc(db, 'rooms', currentPin, 'typing', currentUser.uid);

    try {
        if (isTyping) {
            await setDoc(typingDocRef, { username: currentUsername }, { merge: true });
        } else {
            await deleteDoc(typingDocRef);
        }
    } catch (e) {
        console.error("Error updating typing status:", e);
    }
}

async function leaveRoom() {
    if (currentPin && currentUser) {
        // Cleanup presence manually before reload
        try {
            await deleteDoc(doc(db, 'rooms', currentPin, 'members', currentUser.uid));
            await deleteDoc(doc(db, 'rooms', currentPin, 'typing', currentUser.uid));
        } catch (e) {
            console.error(e);
        }
    }
    window.location.reload();
}

function addMessageToUI(id, data, isMe) {
    const messageEl = document.createElement('div');
    messageEl.classList.add('message', isMe ? 'sent' : 'received');
    messageEl.id = `msg-${id}`;

    const senderEl = document.createElement('div');
    senderEl.classList.add('sender-name');
    senderEl.textContent = isMe ? 'You' : data.sender;
    messageEl.appendChild(senderEl);

    if (data.type === 'image') {
        const imgContainer = document.createElement('div');
        imgContainer.classList.add('image-container');

        const img = document.createElement('img');
        img.classList.add('chat-image');
        img.src = data.imageURL;
        img.alt = 'Shared image';
        img.loading = 'lazy';
        imgContainer.appendChild(img);

        const downloadBtn = document.createElement('a');
        downloadBtn.classList.add('download-btn');
        downloadBtn.href = data.imageURL;
        downloadBtn.download = `pinchat_image_${id}`;
        downloadBtn.target = '_blank';
        downloadBtn.title = 'Download image';
        downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        imgContainer.appendChild(downloadBtn);

        messageEl.appendChild(imgContainer);

        if (data.caption) {
            const captionEl = document.createElement('div');
            captionEl.classList.add('image-caption');
            captionEl.textContent = data.caption;
            messageEl.appendChild(captionEl);
        }
    } else {
        const textEl = document.createElement('div');
        textEl.textContent = data.text;
        messageEl.appendChild(textEl);
    }

    if (isMe) {
        const deleteBtn = document.createElement('div');
        deleteBtn.classList.add('delete-btn');
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete message';
        deleteBtn.onclick = () => deleteMessage(id);
        messageEl.appendChild(deleteBtn);
    }

    messagesContainer.appendChild(messageEl);
    scrollToBottom();
}

function removeMessageFromUI(id) {
    const msgEl = document.getElementById(`msg-${id}`);
    if (msgEl) {
        msgEl.style.transition = 'opacity 0.2s, transform 0.2s';
        msgEl.style.opacity = '0';
        msgEl.style.transform = 'scale(0.9)';
        setTimeout(() => msgEl.remove(), 200);
    }
}

function deleteMessage(id) {
    deleteDoc(doc(db, 'rooms', currentPin, 'messages', id));
}

function addSystemMessage(text) {
    const msgEl = document.createElement('div');
    msgEl.classList.add('system-message');
    msgEl.textContent = text;
    messagesContainer.appendChild(msgEl);
    scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
