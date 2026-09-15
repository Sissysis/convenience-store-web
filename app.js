/* ============================================================
   CONVENIENCE STORE - APPLICATION LOGIC
   All data stored locally. No external APIs or keys used.
   ============================================================ */

'use strict';

/* ============================================================
   SECURITY MODULE
   ============================================================ */

const Security = (function () {

    if (window.location.protocol === 'http:' && !/localhost|127\.0\.0\.1|^file:/.test(window.location.host || 'file:')) {
        try { window.location.protocol = 'https:'; } catch (e) { /* local usage */ }
    }

    // Pure-JS SHA-256 fallback (used if crypto.subtle is unavailable)
    function sha256Sync(str) {
        function rightRotate(value, amount) {
            return (value >>> amount) | (value << (32 - amount));
        }
        const mathPow = Math.pow;
        const maxWord = mathPow(2, 32);
        let result = '';
        const words = [];
        const asciiBitLength = str.length * 8;
        let hash = [];
        let k = [];
        let primeCounter = 0;
        const isComposite = {};
        for (let candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (let i = 0; i < 313; i += candidate) {
                    isComposite[i] = candidate;
                }
                hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
                k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            }
        }
        str += '\x80';
        while (str.length % 64 - 56) str += '\x00';
        for (let i = 0; i < str.length; i++) {
            const j = str.charCodeAt(i);
            if (j >> 8) return '';
            words[i >> 2] |= j << ((3 - i) % 4) * 8;
        }
        words[words.length] = ((asciiBitLength / maxWord) | 0);
        words[words.length] = asciiBitLength;
        for (let j = 0; j < words.length;) {
            const w = words.slice(j, j += 16);
            const oldHash = hash;
            hash = hash.slice(0, 8);
            for (let i = 0; i < 64; i++) {
                const w15 = w[i - 15];
                const w2 = w[i - 2];
                const a = hash[0];
                const e = hash[4];
                const temp1 = hash[7]
                    + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
                    + ((e & hash[5]) ^ (~e & hash[6]))
                    + k[i]
                    + (w[i] = (i < 16) ? w[i] : (
                        w[i - 16]
                        + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
                        + w[i - 7]
                        + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
                    ) | 0);
                const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
                    + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
                hash = [(temp1 + temp2) | 0].concat(hash);
                hash[4] = (hash[4] + temp1) | 0;
            }
            for (let i = 0; i < 8; i++) {
                hash[i] = (hash[i] + oldHash[i]) | 0;
            }
        }
        for (let i = 0; i < 8; i++) {
            for (let j = 3; j + 1; j--) {
                const b = (hash[i] >> (j * 8)) & 255;
                result += ((b < 16) ? 0 : '') + b.toString(16);
            }
        }
        return result;
    }

    async function sha256(text) {
        try {
            if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
                const encoder = new TextEncoder();
                const data = encoder.encode(text);
                const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(hashBuffer))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            }
        } catch (e) { /* fall through to JS impl */ }
        return sha256Sync(text);
    }

    function genRand(bytes) {
        if (window.crypto && window.crypto.getRandomValues) {
            const arr = new Uint8Array(bytes);
            window.crypto.getRandomValues(arr);
            return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        let out = '';
        for (let i = 0; i < bytes; i++) {
            out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
        }
        return out;
    }

    async function hashPassword(password, salt) {
        let hash = salt + '::' + password;
        for (let i = 0; i < 10; i++) {
            hash = await sha256(hash);
        }
        return hash;
    }

    function generateSalt() {
        return genRand(16);
    }

    function generateId() {
        return Date.now().toString(36) + '-' + genRand(8);
    }

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sanitize(value, maxLen) {
        if (typeof value !== 'string') return '';
        value = value.trim();
        if (maxLen && value.length > maxLen) value = value.slice(0, maxLen);
        return value.replace(/[<>]/g, '');
    }

    function isValidUsername(name) {
        return /^[a-zA-Z0-9_ .\-]{3,40}$/.test(name);
    }

    function isValidNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) && num >= 0;
    }

    function toNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    }

    return {
        hashPassword, generateSalt, generateId,
        escapeHtml, sanitize, isValidUsername,
        isValidNumber, toNumber
    };
})();

/* ============================================================
   DATA STORAGE (localStorage, scoped per user)
   ============================================================ */

const Store = (function () {

    const PREFIX = 'convstore_';

    function get(key, fallback) {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function set(key, value) {
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify(value));
        } catch (e) {
            if (typeof UI !== 'undefined') {
                UI.notify('Storage is full or unavailable.', 'error');
            }
        }
    }

    function remove(key) {
        localStorage.removeItem(PREFIX + key);
    }

    return { get, set, remove };
})();

/* ============================================================
   AUTH MODULE
   ============================================================ */

const Auth = (function () {

    const SESSION_KEY = 'session';
    const LOGIN_ATTEMPTS_KEY = 'login_attempts';
    const MAX_ATTEMPTS = 5;
    const LOCK_MS = 15 * 60 * 1000;

    function getUsers() {
        return Store.get('users', {});
    }

    function saveUsers(users) {
        Store.set('users', users);
    }

    function getUserData(username) {
        return Store.get('user_' + username.toLowerCase(), null);
    }

    function saveUserData(username, data) {
        Store.set('user_' + username.toLowerCase(), data);
    }

    function getCurrentUser() {
        const session = Store.get(SESSION_KEY, null);
        if (!session) return null;
        const users = getUsers();
        return users[session.userId] ? session : null;
    }

    function checkLocked(username) {
        const attempts = Store.get(LOGIN_ATTEMPTS_KEY, {});
        const record = attempts[username.toLowerCase()] || { count: 0, ts: 0 };
        return record.count >= MAX_ATTEMPTS && (Date.now() - record.ts) < LOCK_MS;
    }

    function remainingLockTime(username) {
        const attempts = Store.get(LOGIN_ATTEMPTS_KEY, {});
        const record = attempts[username.toLowerCase()] || { count: 0, ts: 0 };
        const remain = LOCK_MS - (Date.now() - record.ts);
        return remain > 0 && record.count >= MAX_ATTEMPTS ? remain : 0;
    }

    function recordFailedAttempt(username) {
        const attempts = Store.get(LOGIN_ATTEMPTS_KEY, {});
        const key = username.toLowerCase();
        const record = attempts[key] || { count: 0, ts: 0 };
        if (Date.now() - record.ts > LOCK_MS) {
            record.count = 1;
        } else {
            record.count += 1;
        }
        record.ts = Date.now();
        attempts[key] = record;
        Store.set(LOGIN_ATTEMPTS_KEY, attempts);
        return record.count;
    }

    function resetAttempts(username) {
        const attempts = Store.get(LOGIN_ATTEMPTS_KEY, {});
        attempts[username.toLowerCase()] = { count: 0, ts: 0 };
        Store.set(LOGIN_ATTEMPTS_KEY, attempts);
    }

    async function register(username, password) {
        const users = getUsers();
        const existing = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
        if (existing) {
            return { ok: false, message: 'Username is already taken.' };
        }

        const salt = Security.generateSalt();
        const hash = await Security.hashPassword(password, salt);
        const userId = Security.generateId();

        const user = {
            id: userId,
            username: username,
            usernameLower: username.toLowerCase(),
            salt: salt,
            hash: hash,
            createdAt: Date.now()
        };

        users[userId] = user;
        saveUsers(users);

        saveUserData(username, { products: [], notes: [], lists: [], debts: [] });

        return { ok: true, user: user };
    }

    async function login(username, password) {
        if (checkLocked(username)) {
            const mins = Math.ceil(remainingLockTime(username) / 60000);
            return { ok: false, message: 'Too many attempts. Try again in ~' + mins + ' min.' };
        }

        const users = getUsers();
        const account = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());

        if (!account) {
            recordFailedAttempt(username);
            return { ok: false, message: 'No account found with that username.' };
        }

        const hash = await Security.hashPassword(password, account.salt);
        if (hash !== account.hash) {
            const count = recordFailedAttempt(username);
            const left = MAX_ATTEMPTS - count;
            return {
                ok: false,
                message: 'Incorrect password.' + (left > 0 ? ' Attempts left: ' + left : ' Account temporarily locked.')
            };
        }

        resetAttempts(username);
        Store.set(SESSION_KEY, { userId: account.id, username: account.username, loginAt: Date.now() });
        return { ok: true, user: account };
    }

    function logout() {
        Store.remove(SESSION_KEY);
    }

    return {
        register, login, logout, getCurrentUser, getUserData, saveUserData, checkLocked
    };
})();

/* ============================================================
   UI HELPERS
   ============================================================ */

const UI = {
    showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(name + '-screen').classList.add('active');
        window.scrollTo(0, 0);
    },

    formatMoney(amount) {
        return '\u20B1' + Number(amount).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    },

    notify(message, type) {
        const container = document.getElementById('notification-container');
        if (!container) return;
        const icons = { success: '\u2705', warning: '\u26A0\uFE0F', error: '\u274C', info: '\u2139\uFE0F' };
        const el = document.createElement('div');
        el.className = 'notification ' + (type || 'info');
        el.innerHTML = '<span class="notify-icon">' + (icons[type] || icons.info) + '</span><span>' +
            Security.escapeHtml(message) + '</span>';
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('out');
            setTimeout(() => el.remove(), 400);
        }, 4000);
    },

    openModal(html) {
        const overlay = document.getElementById('modal-overlay');
        document.getElementById('modal-body').innerHTML = html;
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },

    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.add('hidden');
        document.getElementById('modal-body').innerHTML = '';
        document.body.style.overflow = '';
    },

    setFieldError(inputId, message) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const err = el.closest('.form-group') ? el.closest('.form-group').querySelector('.error-msg') : null;
        if (err) {
            err.textContent = message;
            err.classList.add('visible');
        }
    },

    clearFieldError(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const err = el.closest('.form-group') ? el.closest('.form-group').querySelector('.error-msg') : null;
        if (err) {
            err.textContent = '';
            err.classList.remove('visible');
        }
    },

    clearAllFieldErrors() {
        document.querySelectorAll('.error-msg').forEach(e => {
            e.textContent = '';
            e.classList.remove('visible');
        });
    }
};

/* ============================================================
   ACTION CONTEXT (which record the open modal is editing)
   ============================================================ */

const ActionContext = {
    productId: null,
    noteId: null,
    debtId: null
};

/* ============================================================
   PRODUCTS MODULE
   ============================================================ */

const Products = (function () {

    const LOW_STOCK_THRESHOLD = 10;

    function getAll() {
        const session = Auth.getCurrentUser();
        if (!session) return [];
        return Auth.getUserData(session.username).products || [];
    }

    function findById(id) {
        return getAll().find(p => p.id === id) || null;
    }

    function save(products) {
        const session = Auth.getCurrentUser();
        if (!session) return;
        const data = Auth.getUserData(session.username);
        data.products = products;
        Auth.saveUserData(session.username, data);
    }

    function add(name, price, stock) {
        const products = getAll();
        const product = {
            id: Security.generateId(),
            name: name,
            price: price,
            stock: Math.max(0, Math.floor(stock)),
            createdAt: Date.now()
        };
        products.push(product);
        save(products);
        return product;
    }

    function update(id, name, price) {
        const products = getAll();
        const idx = products.findIndex(p => p.id === id);
        if (idx === -1) return null;
        products[idx].name = name;
        products[idx].price = price;
        products[idx].updatedAt = Date.now();
        save(products);
        return products[idx];
    }

    function remove(id) {
        save(getAll().filter(p => p.id !== id));
    }

    function decrement(id, qty) {
        qty = Math.max(1, Math.floor(qty || 1));
        const products = getAll();
        const idx = products.findIndex(p => p.id === id);
        if (idx === -1) return null;
        const before = products[idx].stock;
        products[idx].stock = Math.max(0, products[idx].stock - qty);
        save(products);
        const after = products[idx].stock;

        if (after === 0) {
            UI.notify('"' + products[idx].name + '" is now OUT OF STOCK!', 'warning');
        } else if (after <= LOW_STOCK_THRESHOLD && before > LOW_STOCK_THRESHOLD) {
            UI.notify('Low stock: "' + products[idx].name + '" only ' + after + ' pcs left!', 'warning');
        }
        return products[idx];
    }

    function addStock(id, qty) {
        qty = Math.max(0, Math.floor(qty));
        if (qty === 0) return null;
        const products = getAll();
        const idx = products.findIndex(p => p.id === id);
        if (idx === -1) return null;
        products[idx].stock += qty;
        save(products);
        return products[idx];
    }

    function search(term) {
        const all = getAll();
        term = (term || '').trim().toLowerCase();
        if (!term) return all;
        return all.filter(p => p.name.toLowerCase().includes(term));
    }

    function getLowStock() {
        return getAll().filter(p => p.stock <= LOW_STOCK_THRESHOLD);
    }

    return {
        LOW_STOCK_THRESHOLD, getAll, findById, add, update,
        remove, decrement, addStock, search, getLowStock
    };
})();

/* ============================================================
   NOTES MODULE
   ============================================================ */

const Notes = (function () {

    function getAll() {
        const session = Auth.getCurrentUser();
        if (!session) return [];
        return Auth.getUserData(session.username).notes || [];
    }

    function save(notes) {
        const session = Auth.getCurrentUser();
        if (!session) return;
        const data = Auth.getUserData(session.username);
        data.notes = notes;
        Auth.saveUserData(session.username, data);
    }

    function add(content) {
        const notes = getAll();
        const note = { id: Security.generateId(), content: content, createdAt: Date.now() };
        notes.push(note);
        save(notes);
        return note;
    }

    function update(id, content) {
        const notes = getAll();
        const idx = notes.findIndex(n => n.id === id);
        if (idx === -1) return null;
        notes[idx].content = content;
        notes[idx].updatedAt = Date.now();
        save(notes);
        return notes[idx];
    }

    function remove(id) {
        save(getAll().filter(n => n.id !== id));
    }

    return { getAll, add, update, remove };
})();

/* ============================================================
   DEBTS MODULE (owned / owed products - Utang tracker)
   ============================================================ */

const Debts = (function () {

    function getAll() {
        const session = Auth.getCurrentUser();
        if (!session) return [];
        return Auth.getUserData(session.username).debts || [];
    }

    function save(debts) {
        const session = Auth.getCurrentUser();
        if (!session) return;
        const data = Auth.getUserData(session.username);
        data.debts = debts;
        Auth.saveUserData(session.username, data);
    }

    function computeTotal(items) {
        return items.reduce((sum, it) => sum + (it.price * it.quantity), 0);
    }

    function add(debtorName, items) {
        const debts = getAll();
        const debt = {
            id: Security.generateId(),
            debtorName: debtorName,
            items: items,
            total: computeTotal(items),
            paid: false,
            createdAt: Date.now()
        };
        debts.push(debt);
        save(debts);
        return debt;
    }

    function markAllPaid(id) {
        const debts = getAll();
        const idx = debts.findIndex(d => d.id === id);
        if (idx === -1) return null;
        debts[idx].paid = true;
        debts[idx].paidAt = Date.now();
        save(debts);
        return debts[idx];
    }

    function addItems(id, items) {
        const debts = getAll();
        const idx = debts.findIndex(d => d.id === id);
        if (idx === -1) return null;
        const debt = debts[idx];
        if (debt.paid) return null;
        debt.items = (debt.items || []).concat(items);
        debt.total = computeTotal(debt.items);
        debt.updatedAt = Date.now();
        save(debts);
        return debt;
    }

    function remove(id) {
        save(getAll().filter(d => d.id !== id));
    }

    return { getAll, add, addItems, markAllPaid, remove, computeTotal };
})();

/* ============================================================
   TEXT HELPERS
   ============================================================ */

function titleCase(str) {
    return String(str).replace(/[A-Za-z0-9\u00C0-\u024F]+/g, function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

function firstCap(str) {
    const s = String(str);
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ============================================================
   RENDER FUNCTIONS
   ============================================================ */

function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
}

function renderProducts(filterTerm) {
    const container = document.getElementById('products-container');
    let products = Products.search(filterTerm || '');

    products = products.slice().sort((a, b) => {
        const aEmpty = a.stock === 0 ? 1 : 0;
        const bEmpty = b.stock === 0 ? 1 : 0;
        if (aEmpty !== bEmpty) return aEmpty - bEmpty;
        return b.createdAt - a.createdAt;
    });

    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">\u{1F6D2}</span>' +
            (filterTerm ? 'No products match your search.' : 'No products yet. Click "+ Add Product" to start!') +
            '</div>';
        return;
    }

    container.innerHTML = products.map(p => {
        const low = p.stock <= Products.LOW_STOCK_THRESHOLD && p.stock > 0;
        const empty = p.stock === 0;
        const stockClass = empty ? 'empty' : low ? 'low' : 'ok';
        const stockLabel = empty ? 'OUT OF STOCK' : low ? 'LOW STOCK: ' + p.stock + ' pcs' : 'In stock: ' + p.stock + ' pcs';
        const cardClass = empty ? 'product-card out-of-stock' : low ? 'product-card low-stock' : 'product-card';
        return '<div class="' + cardClass + '">' +
            '<div class="product-name">' + Security.escapeHtml(p.name) + '</div>' +
            '<div class="product-price">' + UI.formatMoney(p.price) + '</div>' +
            '<span class="product-stock ' + stockClass + '">' + stockLabel + '</span>' +
            '<div class="product-actions">' +
                '<button class="minus-btn" data-action="minus" data-id="' + p.id + '" ' + (empty ? 'disabled' : '') + ' title="Someone bought - minus 1">\u2212 1</button>' +
                '<button class="edit-btn" data-action="edit" data-id="' + p.id + '">Edit</button>' +
                '<button class="delete-btn" data-action="delete" data-id="' + p.id + '">\u2715</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function renderNotes() {
    const container = document.getElementById('notes-container');
    const notes = Notes.getAll().slice().sort((a, b) => b.createdAt - a.createdAt);

    if (notes.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">\u{1F4DD}</span>No notes yet.</div>';
        return;
    }

    container.innerHTML = notes.map(n =>
        '<div class="note-item">' +
            '<div class="note-text">' + Security.escapeHtml(n.content).replace(/\n/g, '<br>') + '</div>' +
            '<div class="note-meta">' + formatDate(n.createdAt) + '</div>' +
            '<div class="note-actions">' +
                '<button class="note-edit" data-action="edit-note" data-id="' + n.id + '">Edit</button>' +
                '<button class="note-delete" data-action="delete-note" data-id="' + n.id + '">Delete</button>' +
            '</div>' +
        '</div>'
    ).join('');
}

function renderLists() {
    const container = document.getElementById('lists-container');
    const products = Products.getAll().slice().sort((a, b) => b.createdAt - a.createdAt);

    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">\u{1F4CB}</span>No products yet. Add products to see your inventory here.</div>';
        return;
    }

    container.innerHTML =
        '<div class="lists-inventory">' +
            '<table class="inventory-table">' +
                '<thead>' +
                    '<tr><th>Product</th><th>Price</th><th>Qty</th></tr>' +
                '</thead>' +
                '<tbody>' +
                    products.map(p => {
                        const qtyClass = p.stock === 0 ? 't-qty empty' : p.stock <= Products.LOW_STOCK_THRESHOLD ? 't-qty low' : 't-qty';
                        return '<tr>' +
                            '<td class="t-name">' + Security.escapeHtml(p.name) + '</td>' +
                            '<td class="t-price">' + UI.formatMoney(p.price) + '</td>' +
                            '<td class="' + qtyClass + '">' + p.stock + ' pcs</td>' +
                        '</tr>';
                    }).join('') +
                '</tbody>' +
            '</table>' +
        '</div>';
}

function renderDebts() {
    const container = document.getElementById('debts-container');
    const debts = Debts.getAll().slice().sort((a, b) => {
        if (a.paid !== b.paid) return a.paid ? 1 : -1;
        return b.createdAt - a.createdAt;
    });

    if (debts.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">\u{1F4B0}</span>No owed records yet.<br>Click "+ Add Debtor" to track someone who owes you.</div>';
        return;
    }

    container.innerHTML = debts.map(d => {
        const itemsHtml = d.items.map(it =>
            '<li><span class="item-left"><span class="debt-item-qty">' + it.quantity + '\u00D7</span>' + Security.escapeHtml(it.name) + '</span><span>' + UI.formatMoney(it.price * it.quantity) + '</span></li>'
        ).join('');

        return '<div class="debt-card ' + (d.paid ? 'paid-out' : '') + '">' +
            '<div class="debt-header">' +
                '<span class="debt-name">' + Security.escapeHtml(d.debtorName) + '</span>' +
                '<span class="debt-status ' + (d.paid ? 'paid' : 'unpaid') + '">' + (d.paid ? 'PAID' : 'UNPAID') + '</span>' +
            '</div>' +
            '<ul class="debt-items-list">' + itemsHtml + '</ul>' +
            '<div class="debt-total">' +
                '<span class="debt-total-label">Total Owed</span>' +
                '<span class="debt-total-amount">' + UI.formatMoney(d.total) + '</span>' +
            '</div>' +
            '<div class="debt-actions">' +
                (d.paid ? '' : '<button class="add-debt-item-btn" data-action="add-item-debt" data-id="' + d.id + '">+ Add Item</button>') +
                '<button class="pay-btn" data-action="pay-all" data-id="' + d.id + '" ' + (d.paid ? 'disabled' : '') + '>Pay All</button>' +
                '<button class="debt-delete-btn" data-action="delete-debt" data-id="' + d.id + '">\u2715</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

/* ============================================================
   MODAL TEMPLATES
   ============================================================ */

function showAddProductModal() {
    ActionContext.productId = null;
    UI.openModal(
        '<h3 class="modal-title">Add New Product</h3>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Product Name <span class="required">*</span></label>' +
            '<input type="text" id="m-name" maxlength="80" class="cap-words" placeholder="e.g. Biscuit, Milk, Soap...">' +
        '</div>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Price <span class="required">*</span></label>' +
            '<input type="number" id="m-price" min="0" step="0.01" placeholder="e.g. 15.50">' +
        '</div>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Stock (pieces)</label>' +
            '<input type="number" id="m-stock" min="0" step="1" placeholder="e.g. 20">' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="modal-btn secondary" data-m-close="1">Cancel</button>' +
            '<button class="modal-btn primary" id="m-save-product">Save Product</button>' +
        '</div>'
    );
}

function showEditProductModal(id) {
    const p = Products.findById(id);
    if (!p) return;
    ActionContext.productId = id;
    UI.openModal(
        '<h3 class="modal-title">Edit Product</h3>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Product Name <span class="required">*</span></label>' +
            '<input type="text" id="m-name" maxlength="80" class="cap-words" value="' + Security.escapeHtml(p.name) + '">' +
        '</div>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Price <span class="required">*</span></label>' +
            '<input type="number" id="m-price" min="0" step="0.01" value="' + p.price + '">' +
        '</div>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Add More Stock</label>' +
            '<input type="number" id="m-add-stock" min="0" step="1" value="0" placeholder="0">' +
            '<div class="modal-req-hint">Current stock: ' + p.stock + ' pcs (enter extra pieces to restock)</div>' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="modal-btn secondary" data-m-close="1">Cancel</button>' +
            '<button class="modal-btn primary" id="m-save-product">Save Changes</button>' +
        '</div>'
    );
}

function showAddNoteModal() {
    ActionContext.noteId = null;
    UI.openModal(
        '<h3 class="modal-title">Add a Note</h3>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Note</label>' +
            '<textarea id="m-note" rows="5" class="cap-first" placeholder="Write your note here..." maxlength="2000"></textarea>' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="modal-btn secondary" data-m-close="1">Cancel</button>' +
            '<button class="modal-btn primary" id="m-save-note">Save Note</button>' +
        '</div>'
    );
}

function showEditNoteModal(id) {
    const note = Notes.getAll().find(n => n.id === id);
    if (!note) return;
    ActionContext.noteId = id;
    UI.openModal(
        '<h3 class="modal-title">Edit Note</h3>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Note</label>' +
            '<textarea id="m-note" rows="5" class="cap-first" maxlength="2000">' + Security.escapeHtml(note.content) + '</textarea>' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="modal-btn secondary" data-m-close="1">Cancel</button>' +
            '<button class="modal-btn primary" id="m-save-note">Save Note</button>' +
        '</div>'
    );
}

function showAddDebtModal() {
    const products = Products.getAll().filter(p => p.stock > 0);

    UI.openModal(
        '<h3 class="modal-title">Add Debtor (OwEd)</h3>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Name <span class="required">*</span></label>' +
            '<input type="text" id="m-debtor-name" maxlength="40" class="cap-words" placeholder="Who owes you?">' +
        '</div>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Items</label>' +
            '<div class="debt-editor-items" id="m-debt-items">' +
                '<div class="empty-state" id="m-debt-empty" style="padding:12px;">' +
                    (products.length ? 'No items yet. Click "+ Add Item" below.' : 'No products in stock to owe right now.') +
                '</div>' +
            '</div>' +
            '<button class="add-btn" id="m-add-debt-item" ' + (products.length ? '' : 'disabled') + ' style="margin-top:10px;">+ Add Item</button>' +
        '</div>' +
        '<div class="modal-field">' +
            '<div class="debt-editor-total">' +
                '<span>Grand Total (auto)</span>' +
                '<span class="grand-total" id="m-debt-grand-total">' + UI.formatMoney(0) + '</span>' +
            '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="modal-btn secondary" data-m-close="1">Cancel</button>' +
            '<button class="modal-btn primary" id="m-save-debt">Save Owed Record</button>' +
        '</div>'
    );
    bindDebtEditorEvents();
}

function showAddDebtItemModal(id) {
    const debt = Debts.getAll().find(d => d.id === id);
    if (!debt || debt.paid) {
        UI.notify('Cannot add items to this owed record.', 'error');
        return;
    }
    const products = Products.getAll().filter(p => p.stock > 0);
    if (!products.length) {
        UI.notify('No products in stock to add right now.', 'warning');
        return;
    }
    ActionContext.debtId = id;

    const optionsHtml = '<option value="">-- Select product --</option>' + products.map(p =>
        '<option value="' + p.id + '" data-price="' + p.price + '">' + Security.escapeHtml(p.name) + ' (' + UI.formatMoney(p.price) + ')</option>'
    ).join('');

    const initialRow =
        '<div class="debt-editor-row">' +
            '<select class="debt-product-select">' + optionsHtml + '</select>' +
            '<input type="number" class="debt-qty" min="1" step="1" value="1" placeholder="Qty">' +
            '<span class="row-total">' + UI.formatMoney(0) + '</span>' +
            '<button class="remove-item" data-action="rm-debt-item">\u2715</button>' +
        '</div>';

    UI.openModal(
        '<h3 class="modal-title">Add Items to ' + Security.escapeHtml(debt.debtorName) + '</h3>' +
        '<div class="modal-field">' +
            '<label class="modal-label">Items</label>' +
            '<div class="debt-editor-items" id="m-debt-items">' + initialRow + '</div>' +
            '<button class="add-btn" id="m-add-debt-item" style="margin-top:10px;">+ Add Item</button>' +
        '</div>' +
        '<div class="modal-field">' +
            '<div class="debt-editor-total">' +
                '<span>New Total (incl. current \u20B1' + debt.total.toFixed(2) + ')</span>' +
                '<span class="grand-total" id="m-debt-grand-total" data-base-total="' + debt.total + '">' + UI.formatMoney(debt.total) + '</span>' +
            '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
            '<button class="modal-btn secondary" data-m-close="1">Cancel</button>' +
            '<button class="modal-btn primary" id="m-save-debt-add">Add Items</button>' +
        '</div>'
    );
    bindDebtEditorEvents();
}

/* ============================================================
   DEBT EDITOR EVENTS
   ============================================================ */

function bindDebtEditorEvents() {
    const items = document.getElementById('m-debt-items');
    if (!items) return;

    function showEmpty() {
        let hint = items.querySelector('#m-debt-empty');
        if (!hint) {
            const products = Products.getAll().filter(p => p.stock > 0);
            const p = document.createElement('div');
            p.id = 'm-debt-empty';
            p.className = 'empty-state';
            p.style.padding = '12px';
            p.textContent = products.length ? 'No items yet. Click "+ Add Item" below.' : 'No products in stock to owe right now.';
            items.appendChild(p);
        }
    }

    function hideEmpty() {
        const hint = items.querySelector('#m-debt-empty');
        if (hint) hint.remove();
    }

    function updateTotals() {
        let total = 0;
        items.querySelectorAll('.debt-editor-row').forEach(row => {
            const select = row.querySelector('.debt-product-select');
            const qtyInput = row.querySelector('.debt-qty');
            const rowTotal = row.querySelector('.row-total');
            const price = select && select.selectedOptions.length
                ? Number(select.selectedOptions[0].dataset.price || 0) : 0;
            const qty = Math.max(0, parseInt(qtyInput ? qtyInput.value : '0', 10) || 0);
            const sum = price * qty;
            total += sum;
            if (rowTotal) rowTotal.textContent = UI.formatMoney(sum);
        });
        const grand = document.getElementById('m-debt-grand-total');
        if (grand) {
            const base = Number(grand.dataset.baseTotal || 0);
            grand.textContent = UI.formatMoney(total + base);
        }
    }

    items.addEventListener('change', (e) => {
        if (e.target.matches('select, input')) updateTotals();
    });
    items.addEventListener('input', (e) => {
        if (e.target.matches('input[type="number"]')) updateTotals();
    });

    items.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="rm-debt-item"]');
        if (!btn) return;
        btn.closest('.debt-editor-row').remove();
        updateTotals();
        if (!items.querySelector('.debt-editor-row')) showEmpty();
    });

    const addBtn = document.getElementById('m-add-debt-item');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const products = Products.getAll().filter(p => p.stock > 0);
            if (!products.length) return;
            hideEmpty();
            const optionsHtml = '<option value="">-- Select product --</option>' + products.map(p =>
                '<option value="' + p.id + '" data-price="' + p.price + '">' + Security.escapeHtml(p.name) + ' (' + UI.formatMoney(p.price) + ')</option>'
            ).join('');
            const row = document.createElement('div');
            row.className = 'debt-editor-row';
            row.innerHTML =
                '<select class="debt-product-select">' + optionsHtml + '</select>' +
                '<input type="number" class="debt-qty" min="1" step="1" value="1" placeholder="Qty">' +
                '<span class="row-total">' + UI.formatMoney(0) + '</span>' +
                '<button class="remove-item" data-action="rm-debt-item">\u2715</button>';
            items.appendChild(row);
            updateTotals();
        });
    }

    updateTotals();
}

function collectDebtRows() {
    const rows = document.querySelectorAll('#m-debt-items .debt-editor-row');
    const items = [];
    for (const row of rows) {
        const select = row.querySelector('.debt-product-select');
        const qtyInput = row.querySelector('.debt-qty');
        if (!select || !select.value) continue;
        const product = Products.findById(select.value);
        if (!product) continue;
        const qty = Math.max(1, Math.floor(Security.toNumber(qtyInput.value)) || 1);
        if (qty > product.stock) {
            UI.notify('"' + product.name + '" only has ' + product.stock + ' pcs in stock.', 'error');
            return { ok: false, items: [] };
        }
        items.push({
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: qty
        });
    }
    return { ok: true, items: items };
}

/* ============================================================
   EVENT WIRING
   ============================================================ */

function wireGlobalEvents() {

    // Floating items on opening screen (emoji + cute SVG)
    const floating = ['\u{1F35E}', '\u{1F34E}', '\u{1F356}', '\u{1F37A}', '\u{1F36B}', '\u{1F36F}', '\u{1F355}', '\u{1F950}', '\u{1F35A}', '\u{1F952}', '\u{1F353}', '\u{1F966}', '\u{1F9C0}', '\u{1F36E}'];
    const floatingSvg = [
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 12 22 1.41 11.41a2 2 0 0 1 0-2.82L8 2h11a3 3 0 0 1 3 3Z"/><circle cx="7" cy="7" r="0.5"/><circle cx="17" cy="7" r="0.5"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8Z"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path d="M21 12h-7M2 12h4"/></svg>'
    ];
    const container = document.getElementById('floating-items');
    for (let i = 0; i < 18; i++) {
        const el = document.createElement('span');
        el.className = 'floating-item';
        if (i % 3 === 1) {
            el.classList.add('floating-svg');
            const svgWrap = document.createElement('span');
            svgWrap.style.color = i % 2 ? '#ff9a3d' : '#ff7a00';
            el.innerHTML = floatingSvg[i % floatingSvg.length];
            el.style.width = (20 + Math.random() * 28) + 'px';
            el.style.height = el.style.width;
            el.style.fontSize = 'inherit';
        } else {
            el.textContent = floating[i % floating.length];
            el.style.fontSize = (22 + Math.random() * 32) + 'px';
        }
        el.style.left = (Math.random() * 95) + '%';
        el.style.animationDuration = (12 + Math.random() * 18) + 's';
        el.style.animationDelay = (Math.random() * 12) + 's';
        container.appendChild(el);
    }

    // START button -> go to auth
    document.getElementById('start-btn').addEventListener('click', () => {
        UI.showScreen('auth');
    });

    // Auth tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.getElementById('login-form').classList.toggle('active', tab === 'login');
            document.getElementById('register-form').classList.toggle('active', tab === 'register');
            UI.clearAllFieldErrors();
            document.querySelectorAll('.auth-message').forEach(m => {
                m.textContent = '';
                m.classList.remove('visible');
            });
        });
    });

    /* ---------- REGISTER ---------- */
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        UI.clearAllFieldErrors();
        const messageEl = document.getElementById('register-message');
        messageEl.classList.remove('visible', 'success', 'error');

        if (document.getElementById('reg-hp').value) {
            UI.notify('Submission rejected.', 'error');
            return;
        }

        const username = Security.sanitize(document.getElementById('reg-username').value, 40);
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm').value;

        let valid = true;
        if (!Security.isValidUsername(username)) {
            UI.setFieldError('reg-username', 'Use 3-40 chars: letters, numbers, space, dot, dash, underscore.');
            valid = false;
        }
        if (password.length < 6) {
            UI.setFieldError('reg-password', 'Password must be at least 6 characters.');
            valid = false;
        }
        if (password !== confirm) {
            UI.setFieldError('reg-confirm', 'Passwords do not match.');
            valid = false;
        }
        if (!valid) return;

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            const result = await Auth.register(username, password);
            if (result.ok) {
                messageEl.classList.add('visible', 'success');
                messageEl.textContent = 'Account created! Please login.';
                UI.notify('Account created! You can now login.', 'success');
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-tab="login"]').classList.add('active');
                document.getElementById('login-form').classList.add('active');
                document.getElementById('register-form').classList.remove('active');
                document.getElementById('login-username').value = username;
                document.getElementById('login-password').value = '';
                e.target.reset();
            } else {
                messageEl.classList.add('visible', 'error');
                messageEl.textContent = result.message;
            }
        } catch (err) {
            messageEl.classList.add('visible', 'error');
            messageEl.textContent = 'Something went wrong. Try again.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Account';
        }
    });

    /* ---------- LOGIN ---------- */
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        UI.clearAllFieldErrors();
        const messageEl = document.getElementById('login-message');
        messageEl.classList.remove('visible', 'success', 'error');

        if (document.getElementById('login-hp').value) {
            UI.notify('Submission rejected.', 'error');
            return;
        }

        const username = Security.sanitize(document.getElementById('login-username').value, 40);
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
            UI.notify('Please fill in username and password.', 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in...';

        try {
            const result = await Auth.login(username, password);
            if (result.ok) {
                enterStore(result.user);
            } else {
                messageEl.classList.add('visible', 'error');
                messageEl.textContent = result.message;
            }
        } catch (err) {
            messageEl.classList.add('visible', 'error');
            messageEl.textContent = 'Login failed. Try again.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Login';
        }
    });

    /* ---------- SIGN OUT ---------- */
    document.getElementById('signout-btn').addEventListener('click', () => {
        Auth.logout();
        UI.showScreen('auth');
        document.getElementById('login-form').reset();
        document.getElementById('register-form').reset();
        UI.clearAllFieldErrors();
        document.querySelectorAll('.auth-message').forEach(m => {
            m.textContent = '';
            m.classList.remove('visible');
        });
        UI.notify('Signed out. Store is CLOSED.', 'info');
    });

    /* ---------- SEARCH ---------- */
    let searchTimer = null;
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderProducts(e.target.value), 200);
    });
    searchInput.addEventListener('search', () => renderProducts(searchInput.value));

    /* ---------- AUTO-CAPITALIZE (cap-words / cap-first) ---------- */
    document.addEventListener('input', (e) => {
        const el = e.target;
        if (!el || !el.tagName) return;
        const tag = el.tagName.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') return;
        if (!el.classList.contains('cap-words') && !el.classList.contains('cap-first')) return;
        const capWords = el.classList.contains('cap-words');
        const hasSelection = (typeof el.selectionStart === 'number');
        const start = hasSelection ? el.selectionStart : 0;
        const raw = el.value;
        const transformed = capWords ? titleCase(raw) : firstCap(raw);
        if (transformed !== raw) {
            el.value = transformed;
            if (hasSelection && typeof el.setSelectionRange === 'function') {
                const pos = Math.min(start, transformed.length);
                el.setSelectionRange(pos, pos);
            }
        }
    });

    /* ---------- NAV BUTTONS ---------- */
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const target = document.getElementById(view + '-view');
            if (target) target.classList.add('active');
            if (view === 'lists') renderLists();
        });
    });

    /* ---------- TOP BAR BUTTONS ---------- */
    document.getElementById('add-product-btn').addEventListener('click', showAddProductModal);
    document.getElementById('add-debt-btn').addEventListener('click', showAddDebtModal);
    document.getElementById('notes-fab').addEventListener('click', showAddNoteModal);

    /* ---------- MODAL CLOSE ---------- */
    document.getElementById('modal-close').addEventListener('click', UI.closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-overlay')) UI.closeModal();
        const closeBtn = e.target.closest('[data-m-close]');
        if (closeBtn) UI.closeModal();
    });

    /* ---------- DELEGATED ITEM ACTIONS ---------- */
    document.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
            const action = actionEl.dataset.action;
            const id = actionEl.dataset.id;

            switch (action) {
                case 'minus':
                    Products.decrement(id, 1);
                    renderProducts();
                    renderLists();
                    break;
                case 'edit':
                    showEditProductModal(id);
                    break;
                case 'delete': {
                    const p = Products.findById(id);
                    if (p && confirm('Delete "' + p.name + '" from products?')) {
                        Products.remove(id);
                        renderProducts();
                        renderLists();
                        UI.notify('Product deleted.', 'info');
                    }
                    break;
                }
                case 'edit-note':
                    showEditNoteModal(id);
                    break;
                case 'delete-note': {
                    if (confirm('Delete this note?')) {
                        Notes.remove(id);
                        renderNotes();
                    }
                    break;
                }
                case 'add-item-debt':
                    showAddDebtItemModal(id);
                    break;
                case 'pay-all': {
                    const debt = Debts.getAll().find(d => d.id === id);
                    if (debt && !debt.paid) {
                        if (confirm('Mark "' + debt.debtorName + '" as fully paid (' + UI.formatMoney(debt.total) + ')?')) {
                            Debts.markAllPaid(id);
                            renderDebts();
                            UI.notify(debt.debtorName + ' paid all! \u{1F389}', 'success');
                        }
                    }
                    break;
                }
                case 'delete-debt': {
                    if (confirm('Delete this owed record?')) {
                        Debts.remove(id);
                        renderDebts();
                    }
                    break;
                }
            }
            return;
        }

        // Expand / collapse product list
        const listHeader = e.target.closest('.list-header');
        if (listHeader && !e.target.closest('button')) {
            listHeader.parentElement.classList.toggle('expanded');
        }
    });

    /* ---------- MODAL SAVE ACTIONS ---------- */
    document.addEventListener('click', (e) => {
        const id = e.target.id;

        if (id === 'm-save-product') {
            const name = Security.sanitize(document.getElementById('m-name').value, 80);
            const priceRaw = document.getElementById('m-price').value;
            const price = Security.toNumber(priceRaw);

            if (!name) {
                UI.notify('Product name is required.', 'error');
                return;
            }
            if (priceRaw === '' || price < 0) {
                UI.notify('Price is required and must be a valid number.', 'error');
                return;
            }
            if (price <= 0) {
                UI.notify('Price must be greater than 0.', 'error');
                return;
            }

            if (ActionContext.productId) {
                const p = Products.findById(ActionContext.productId);
                if (p) {
                    Products.update(ActionContext.productId, name, price);
                    const addStockInput = document.getElementById('m-add-stock');
                    const addStock = addStockInput ? Math.max(0, Math.floor(Security.toNumber(addStockInput.value))) : 0;
                    if (addStock > 0) {
                        Products.addStock(ActionContext.productId, addStock);
                        UI.notify('Restocked +' + addStock + ' pcs of "' + name + '".', 'success');
                    } else {
                        UI.notify('Product updated.', 'success');
                    }
                }
            } else {
                const stockInput = document.getElementById('m-stock');
                const stock = stockInput ? Math.max(0, Math.floor(Security.toNumber(stockInput.value))) : 0;
                const product = Products.add(name, price, stock);
                UI.notify('"' + product.name + '" added to the store!', 'success');
                if (stock === 0) {
                    UI.notify('Note: "' + product.name + '" has 0 stock.', 'info');
                }
            }
            UI.closeModal();
            renderProducts();
            renderLists();
        }

        if (id === 'm-save-note') {
            const content = document.getElementById('m-note').value.trim();
            if (!content) {
                UI.notify('Note cannot be empty.', 'error');
                return;
            }
            if (content.length > 2000) {
                UI.notify('Note is too long.', 'error');
                return;
            }
            if (ActionContext.noteId) {
                Notes.update(ActionContext.noteId, content);
                UI.notify('Note updated.', 'success');
            } else {
                Notes.add(content);
                UI.notify('Note added.', 'success');
            }
            ActionContext.noteId = null;
            UI.closeModal();
            renderNotes();
        }

        if (id === 'm-save-debt') {
            const name = Security.sanitize(document.getElementById('m-debtor-name').value, 40);
            if (!name) {
                UI.notify('Debtor name is required.', 'error');
                return;
            }

            const result = collectDebtRows();
            if (!result.ok) return;
            if (result.items.length === 0) {
                UI.notify('Add at least one item.', 'error');
                return;
            }

            result.items.forEach(it => Products.decrement(it.productId, it.quantity));
            const debt = Debts.add(name, result.items);
            UI.notify(name + ' owes ' + UI.formatMoney(debt.total) + '.', 'info');
            UI.closeModal();
            ActionContext.debtId = null;
            renderProducts();
            renderLists();
            renderDebts();
        }

        if (id === 'm-save-debt-add') {
            const debtId = ActionContext.debtId;
            const debt = Debts.getAll().find(d => d.id === debtId);
            if (!debt || debt.paid) {
                UI.notify('Cannot add items to this owed record.', 'error');
                return;
            }

            const result = collectDebtRows();
            if (!result.ok) return;
            if (result.items.length === 0) {
                UI.notify('Select at least one item to add.', 'error');
                return;
            }

            result.items.forEach(it => Products.decrement(it.productId, it.quantity));
            const updated = Debts.addItems(debtId, result.items);
            if (!updated) {
                UI.notify('Cannot add items to this owed record.', 'error');
                return;
            }
            ActionContext.debtId = null;
            UI.notify('Added items to ' + updated.debtorName + '. New total: ' + UI.formatMoney(updated.total) + '.', 'success');
            UI.closeModal();
            renderProducts();
            renderLists();
            renderDebts();
        }
    });
}

/* ============================================================
   ENTER STORE
   ============================================================ */

function enterStore(user) {
    document.getElementById('welcome-user').textContent = 'Hi, ' + user.username;
    document.getElementById('search-input').value = '';
    UI.showScreen('store');
    renderProducts();
    renderNotes();
    renderLists();
    renderDebts();

    const low = Products.getLowStock();
    if (low.length > 0) {
        setTimeout(() => {
            UI.notify(low.length + ' product(s) at or below 10 pcs. Check your stock!', 'warning');
        }, 600);
    }
}

/* ============================================================
   INIT
   ============================================================ */

let booted = false;

function boot() {
    if (booted) return;
    booted = true;

    wireGlobalEvents();
    UI.showScreen('opening');

    const session = Auth.getCurrentUser();
    if (session) {
        const users = Store.get('users', {});
        const account = users[session.userId];
        if (account) {
            enterStore({ username: account.username, id: account.id });
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}