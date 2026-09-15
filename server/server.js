const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ROUNDS = 10;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/* -------------------------------------------------------
   HELPERS
   ------------------------------------------------------- */

function sanitizeUsername(v) {
    const s = String(v || '').trim();
    return /^[a-zA-Z0-9_ .\-]{3,40}$/.test(s) ? s : '';
}

function validHash(h) { return /^[0-9a-f]{64}$/i.test(String(h)); }
function validSalt(s) { return /^[0-9a-f]{32}$/i.test(String(s)); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }

function findUser(lower) {
    const store = db.load();
    for (const id of Object.keys(store.users)) {
        if (store.users[id].usernameLower === lower) return store.users[id];
    }
    return null;
}

function sanitizeString(val, maxLen) {
    const s = String(val || '').trim();
    const out = s.length > maxLen ? s.slice(0, maxLen) : s;
    return out.replace(/[<>]/g, '');
}

function sanitizeProducts(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 2000).map(p => {
        if (!p || typeof p !== 'object') return null;
        const out = {
            id: String(p.id || ''),
            name: sanitizeString(p.name, 80),
            price: typeof p.price === 'number' && p.price >= 0 ? p.price : 0,
            stock: typeof p.stock === 'number' ? Math.max(0, Math.floor(p.stock)) : 0,
            createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now()
        };
        if (p.updatedAt) out.updatedAt = p.updatedAt;
        return out.name ? out : null;
    }).filter(Boolean);
}

function sanitizeNotes(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 2000).map(n => {
        if (!n || typeof n !== 'object') return null;
        return {
            id: String(n.id || ''),
            content: sanitizeString(n.content, 2000),
            createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now()
        };
    }).filter(n => n.content);
}

function sanitizeLists(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 500).map(l => {
        if (!l || typeof l !== 'object') return null;
        return {
            id: String(l.id || ''),
            title: sanitizeString(l.title, 60),
            items: Array.isArray(l.items)
                ? l.items.map(i => sanitizeString(i, 80)).filter(Boolean)
                : [],
            createdAt: typeof l.createdAt === 'number' ? l.createdAt : Date.now()
        };
    }).filter(l => l.title);
}

function sanitizeDebts(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 500).map(d => {
        if (!d || typeof d !== 'object') return null;
        const items = Array.isArray(d.items)
            ? d.items.map(it => {
                if (!it || typeof it !== 'object') return null;
                return {
                    productId: String(it.productId || ''),
                    name: sanitizeString(it.name, 80),
                    price: typeof it.price === 'number' ? it.price : 0,
                    quantity: typeof it.quantity === 'number' ? Math.max(1, Math.floor(it.quantity)) : 1
                };
            }).filter(it => it.name)
            : [];
        const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
        return {
            id: String(d.id || ''),
            debtorName: sanitizeString(d.debtorName, 40),
            items,
            total,
            paid: !!d.paid,
            createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
            paidAt: d.paidAt
        };
    }).filter(d => d.id);
}

function publicData(doc) {
    return {
        products: sanitizeProducts(doc && doc.products),
        notes: sanitizeNotes(doc && doc.notes),
        lists: sanitizeLists(doc && doc.lists),
        debts: sanitizeDebts(doc && doc.debts)
    };
}

/* -------------------------------------------------------
   AUTH MIDDLEWARE
   ------------------------------------------------------- */

function authMiddleware(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token || token.length < 10) return res.status(401).json({ error: 'Not authorized.' });

    const store = db.load();
    for (const id of Object.keys(store.users)) {
        const u = store.users[id];
        if (Array.isArray(u.tokens) && u.tokens.includes(token)) {
            req.user = u;
            req.token = token;
            return next();
        }
    }
    return res.status(401).json({ error: 'Not authorized.' });
}

/* -------------------------------------------------------
   ROUTES - AUTH
   ------------------------------------------------------- */

app.get('/api/health', (req, res) => {
    res.json({ ok: true, t: Date.now() });
});

app.get('/api/salt', (req, res) => {
    const username = sanitizeUsername(req.query.username || '');
    if (!username) return res.status(400).json({ error: 'Invalid username.' });

    const user = findUser(username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'No account found with that username.' });
    res.json({ salt: user.salt, rounds: user.rounds || ROUNDS });
});

app.post('/api/register', (req, res) => {
    const username = sanitizeUsername(req.body.username || '');
    const salt = String(req.body.salt || '');
    const hash = String(req.body.hash || '');
    const rounds = Number(req.body.rounds) || ROUNDS;

    if (!username) return res.status(400).json({ error: 'Invalid username (3-40 chars, letters/numbers/space/._-).' });
    if (!validSalt(salt) || !validHash(hash)) return res.status(400).json({ error: 'Invalid credentials payload.' });
    if (rounds !== ROUNDS) return res.status(400).json({ error: 'Invalid hash rounds.' });

    const store = db.load();
    const lower = username.toLowerCase();
    if (findUser(lower)) return res.status(409).json({ error: 'Username is already taken.' });

    const userId = crypto.randomBytes(8).toString('hex');
    const user = {
        id: userId,
        username: username,
        usernameLower: lower,
        salt: salt,
        hash: hash,
        rounds: rounds,
        tokens: [],
        createdAt: Date.now()
    };
    store.users[userId] = user;
    db.save(store);
    res.json({ ok: true, user: { username: user.username, id: user.id } });
});

app.post('/api/login', (req, res) => {
    const username = sanitizeUsername(req.body.username || '');
    const salt = String(req.body.salt || '');
    const hash = String(req.body.hash || '');
    const rounds = Number(req.body.rounds) || ROUNDS;

    if (!username) return res.status(400).json({ error: 'Invalid username.' });
    if (!validSalt(salt) || !validHash(hash)) return res.status(400).json({ error: 'Invalid credentials payload.' });

    const store = db.load();
    const lower = username.toLowerCase();
    const user = findUser(lower);

    if (!user) return res.status(401).json({ error: 'No account found with that username.' });

    if (user.salt !== salt || user.hash !== hash || user.rounds !== rounds) {
        return res.status(401).json({ error: 'Incorrect password.' });
    }

    const token = newToken();
    if (!Array.isArray(user.tokens)) user.tokens = [];
    user.tokens.push(token);
    if (user.tokens.length > 10) user.tokens = user.tokens.slice(-10);
    db.save(store);

    res.json({
        ok: true,
        token: token,
        user: { username: user.username, id: user.id },
        data: publicData(store.data)
    });
});

app.post('/api/logout', (req, res) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return res.json({ ok: true });

    const store = db.load();
    for (const id of Object.keys(store.users)) {
        const u = store.users[id];
        if (Array.isArray(u.tokens)) {
            const idx = u.tokens.indexOf(token);
            if (idx !== -1) u.tokens.splice(idx, 1);
        }
    }
    db.save(store);
    res.json({ ok: true });
});

/* -------------------------------------------------------
   ROUTES - DATA (global shared store)
   ------------------------------------------------------- */

app.get('/api/data', authMiddleware, (req, res) => {
    const store = db.load();
    res.json(publicData(store.data));
});

app.put('/api/data', authMiddleware, (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid payload.' });

    const store = db.load();
    store.data = {
        products: sanitizeProducts(body.products),
        notes: sanitizeNotes(body.notes),
        lists: sanitizeLists(body.lists),
        debts: sanitizeDebts(body.debts)
    };
    db.save(store);
    res.json({ ok: true });
});

/* -------------------------------------------------------
   STATIC FILES (serve the web app)
   ------------------------------------------------------- */

// Never expose the backend folder (contains the runtime data file).
app.use('/server', (req, res) => res.status(404).end());

app.use(express.static(path.join(__dirname, '..')));

/* -------------------------------------------------------
   START
   ------------------------------------------------------- */

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('Convenience Store server listening on port ' + PORT);
        console.log('Local: http://localhost:' + PORT);
    });
}

module.exports = app;