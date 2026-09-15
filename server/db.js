const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');

let cache = null;

function emptyDb() {
    return {
        users: {},
        data: { products: [], notes: [], lists: [], debts: [] }
    };
}

function load() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        cache = emptyDb();
        persist();
    }
    return cache;
}

function persist() {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    try {
        fs.renameSync(tmp, DB_FILE);
    } catch (e) {
        fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
    }
}

function save(db) {
    cache = db;
    persist();
}

module.exports = { load, save };