/* ============================================
   CONVENIENCE STORE - APP.JS
   ============================================ */
(function () {
    'use strict';

    /* ---------- SECURITY UTILITIES ---------- */
    const MAX_LOGIN_ATTEMPTS = 5;
    const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
    const MAX_INPUT_LENGTH = 500;
    const MAX_NAME_LENGTH = 100;

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function sanitize(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[<>&"'\\/]/g, '').trim().substring(0, MAX_INPUT_LENGTH);
    }

    function sanitizeName(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[<>&"'\\/]/g, '').trim().substring(0, MAX_NAME_LENGTH);
    }

    function validateNumber(val, min, max) {
        var n = parseFloat(val);
        if (isNaN(n)) return null;
        if (min !== undefined && n < min) return null;
        if (max !== undefined && n > max) return null;
        return n;
    }

    async function hashPassword(password) {
        var encoder = new TextEncoder();
        var data = encoder.encode(password + '_store_salt_2024');
        var hashBuffer = await crypto.subtle.digest('SHA-256', data);
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    function getLoginAttempts() {
        try {
            var data = sessionStorage.getItem('loginAttempts');
            return data ? JSON.parse(data) : { count: 0, firstAttempt: 0 };
        } catch (e) {
            return { count: 0, firstAttempt: 0 };
        }
    }

    function setLoginAttempts(attempts) {
        try {
            sessionStorage.setItem('loginAttempts', JSON.stringify(attempts));
        } catch (e) { /* silent */ }
    }

    function checkRateLimit() {
        var attempts = getLoginAttempts();
        var now = Date.now();
        if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
            var elapsed = now - attempts.firstAttempt;
            if (elapsed < LOGIN_LOCKOUT_MS) {
                var remaining = Math.ceil((LOGIN_LOCKOUT_MS - elapsed) / 60000);
                return { blocked: true, minutes: remaining };
            }
            setLoginAttempts({ count: 0, firstAttempt: 0 });
        }
        return { blocked: false };
    }

    function recordFailedLogin() {
        var attempts = getLoginAttempts();
        var now = Date.now();
        if (attempts.count === 0 || (now - attempts.firstAttempt > LOGIN_LOCKOUT_MS)) {
            setLoginAttempts({ count: 1, firstAttempt: now });
        } else {
            attempts.count++;
            setLoginAttempts(attempts);
        }
    }

    function resetLoginAttempts() {
        setLoginAttempts({ count: 0, firstAttempt: 0 });
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }

    function capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    function capitalizeWords(str) {
        if (!str) return '';
        return str.split(' ').map(function (w) {
            if (!w) return w;
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(' ');
    }

    function formatPrice(price) {
        return '₱' + parseFloat(price).toFixed(2);
    }

    function formatDate(ts) {
        var d = new Date(ts);
        var month = (d.getMonth() + 1).toString().padStart(2, '0');
        var day = d.getDate().toString().padStart(2, '0');
        var year = d.getFullYear();
        var hours = d.getHours().toString().padStart(2, '0');
        var mins = d.getMinutes().toString().padStart(2, '0');
        return month + '/' + day + '/' + year + ' ' + hours + ':' + mins;
    }

    /* ---------- DATA MANAGEMENT ---------- */
    var DB = {
        _get: function (key) {
            try {
                var data = localStorage.getItem('cs_' + key);
                return data ? JSON.parse(data) : null;
            } catch (e) {
                return null;
            }
        },
        _set: function (key, value) {
            try {
                localStorage.setItem('cs_' + key, JSON.stringify(value));
            } catch (e) { /* silent */ }
        },
        getUsers: function () { return this._get('users') || []; },
        setUsers: function (u) { this._set('users', u); },
        getProducts: function () { return this._get('products') || []; },
        setProducts: function (p) { this._set('products', p); },
        getNotes: function () { return this._get('notes') || []; },
        setNotes: function (n) { this._set('notes', n); },
        getDebtors: function () { return this._get('debtors') || []; },
        setDebtors: function (d) { this._set('debtors', d); },
        getCurrentUser: function () {
            try {
                var u = localStorage.getItem('cs_currentUser');
                return u ? JSON.parse(u) : null;
            } catch (e) { return null; }
        },
        setCurrentUser: function (u) {
            try {
                localStorage.setItem('cs_currentUser', JSON.stringify(u));
            } catch (e) { /* silent */ }
        },
        clearCurrentUser: function () {
            try {
                localStorage.removeItem('cs_currentUser');
            } catch (e) { /* silent */ }
        }
    };

    /* ---------- STATE ---------- */
    var deferredInstallPrompt = null;
    var state = {
        currentTab: 'products',
        editingProductId: null,
        editingNoteId: null,
        selectedNoteColor: '#E67E00',
        debtorItems: [],
        lowStockNotified: new Set()
    };

    /* ---------- DOM REFERENCES ---------- */
    var $ = function (id) { return document.getElementById(id); };

    /* ---------- AUTH ---------- */
    var authMode = 'login';

    function showAuth() {
        $('splash-screen').classList.add('hidden');
        $('auth-screen').classList.remove('hidden');
        $('main-app').classList.add('hidden');
        authMode = 'login';
        updateAuthUI();
    }

    function showMainApp() {
        $('auth-screen').classList.add('hidden');
        $('main-app').classList.remove('hidden');
        updateStoreBadge(true);
        renderAll();
        checkLowStock();
    }

    function showSplash() {
        $('main-app').classList.add('hidden');
        $('auth-screen').classList.add('hidden');
        $('splash-screen').classList.remove('hidden');
    }

    function updateAuthUI() {
        if (authMode === 'login') {
            $('auth-title').textContent = 'Login';
            $('auth-subtitle').textContent = 'Welcome back to your store!';
            $('auth-submit').textContent = 'Login';
            $('auth-submit').className = 'btn-primary btn-full';
            $('toggle-auth').textContent = 'Register here';
        } else {
            $('auth-title').textContent = 'Register';
            $('auth-subtitle').textContent = 'Create your store account';
            $('auth-submit').textContent = 'Register';
            $('auth-submit').className = 'btn-primary btn-full';
            $('toggle-auth').textContent = 'Login here';
        }
        $('auth-error').classList.add('hidden');
        $('auth-username').value = '';
        $('auth-password').value = '';
        $('auth-honeypot').value = '';
    }

    function showAuthError(msg) {
        var el = $('auth-error');
        el.textContent = msg;
        el.classList.remove('hidden');
        el.style.borderColor = 'rgba(231, 76, 60, 0.3)';
        el.style.background = 'rgba(231, 76, 60, 0.12)';
        el.style.color = '#ff6b6b';
    }

    async function handleAuth(e) {
        e.preventDefault();

        if ($('auth-honeypot').value !== '') return;

        var rateCheck = checkRateLimit();
        if (rateCheck.blocked) {
            showAuthError('Too many attempts. Please wait ' + rateCheck.minutes + ' minute(s).');
            return;
        }

        var username = sanitizeName($('auth-username').value);
        var password = $('auth-password').value;

        if (!username || !password) {
            showAuthError('Please fill in all fields.');
            return;
        }

        if (username.length < 3) {
            showAuthError('Username must be at least 3 characters.');
            return;
        }

        if (password.length < 4) {
            showAuthError('Password must be at least 4 characters.');
            return;
        }

        var hashedPw = await hashPassword(password);
        var users = DB.getUsers();

        if (authMode === 'register') {
            var exists = users.some(function (u) { return u.username.toLowerCase() === username.toLowerCase(); });
            if (exists) {
                showAuthError('Username already taken.');
                recordFailedLogin();
                return;
            }
            users.push({
                id: generateId(),
                username: username,
                password: hashedPw,
                createdAt: Date.now()
            });
            DB.setUsers(users);
            resetLoginAttempts();
            authMode = 'login';
            updateAuthUI();
            showAuthError('');
            $('auth-error').textContent = 'Account created! Please login.';
            $('auth-error').classList.remove('hidden');
            $('auth-error').style.borderColor = 'rgba(39, 174, 96, 0.3)';
            $('auth-error').style.background = 'rgba(39, 174, 96, 0.12)';
            $('auth-error').style.color = '#44bb44';
            return;
        } else {
            var user = users.find(function (u) {
                return u.username.toLowerCase() === username.toLowerCase() && u.password === hashedPw;
            });
            if (!user) {
                showAuthError('Invalid username or password.');
                recordFailedLogin();
                return;
            }
            resetLoginAttempts();
            DB.setCurrentUser({ id: user.id, username: user.username });
            showMainApp();
        }
    }

    function logout() {
        showCloseBadge(function () {
            DB.clearCurrentUser();
            $('main-app').classList.add('hidden');
            $('auth-screen').classList.remove('hidden');
            authMode = 'login';
            updateAuthUI();
        });
    }

    function showCloseBadge(callback) {
        var badge = $('store-badge');
        badge.className = 'store-badge badge-close';
        badge.innerHTML = '<span class="badge-dot"></span>CLOSE!';
        setTimeout(function () {
            if (callback) callback();
            badge.className = 'store-badge badge-open';
            badge.innerHTML = '<span class="badge-dot"></span>OPEN!';
        }, 1500);
    }

    function updateStoreBadge(isOpen) {
        var badge = $('store-badge');
        if (isOpen) {
            badge.className = 'store-badge badge-open';
            badge.innerHTML = '<span class="badge-dot"></span>OPEN!';
        } else {
            badge.className = 'store-badge badge-close';
            badge.innerHTML = '<span class="badge-dot"></span>CLOSE!';
        }
    }

    /* ---------- TABS ---------- */
    function switchTab(tabName) {
        state.currentTab = tabName;
        document.querySelectorAll('.nav-btn[data-tab]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(function (tc) {
            tc.classList.add('hidden');
            tc.classList.remove('active');
        });
        var target = $('tab-' + tabName);
        if (target) {
            target.classList.remove('hidden');
            target.classList.add('active');
        }
        renderAll();
    }

    /* ---------- PRODUCTS ---------- */
    function openAddProductModal() {
        state.editingProductId = null;
        $('product-modal-title').textContent = 'Add New Product';
        $('product-submit-btn').textContent = 'Add Product';
        $('product-name').value = '';
        $('product-price').value = '';
        $('product-quantity').value = '';
        $('product-modal').classList.remove('hidden');
        $('product-name').focus();
    }

    function openEditProductModal(id) {
        var products = DB.getProducts();
        var product = products.find(function (p) { return p.id === id; });
        if (!product) return;

        state.editingProductId = id;
        $('product-modal-title').textContent = 'Edit Product';
        $('product-submit-btn').textContent = 'Save Changes';
        $('product-name').value = product.name;
        $('product-price').value = product.price;
        $('product-quantity').value = product.quantity;
        $('product-modal').classList.remove('hidden');
        $('product-name').focus();
    }

    function closeProductModal() {
        $('product-modal').classList.add('hidden');
        state.editingProductId = null;
    }

    function handleProductSubmit(e) {
        e.preventDefault();

        var name = sanitizeName($('product-name').value);
        var price = validateNumber($('product-price').value, 0.01, 999999);
        var quantity = validateNumber($('product-quantity').value, 0, 999999);

        if (!name) {
            alert('Please enter a valid product name.');
            return;
        }
        if (price === null) {
            alert('Please enter a valid price (minimum ₱0.01).');
            return;
        }
        if (quantity === null || quantity < 0) {
            alert('Please enter a valid quantity (0 or more).');
            return;
        }

        var products = DB.getProducts();

        if (state.editingProductId) {
            var idx = products.findIndex(function (p) { return p.id === state.editingProductId; });
            if (idx !== -1) {
                products[idx].name = capitalizeWords(name);
                products[idx].price = Math.round(price * 100) / 100;
                products[idx].quantity = Math.floor(quantity);
            }
        } else {
            products.push({
                id: generateId(),
                name: capitalizeWords(name),
                price: Math.round(price * 100) / 100,
                quantity: Math.floor(quantity),
                createdAt: Date.now()
            });
        }

        DB.setProducts(products);
        closeProductModal();
        renderAll();
        checkLowStock();
    }

    function quickBuy(id) {
        var products = DB.getProducts();
        var idx = products.findIndex(function (p) { return p.id === id; });
        if (idx === -1) return;
        if (products[idx].quantity <= 0) return;

        products[idx].quantity--;
        DB.setProducts(products);
        renderAll();
        checkLowStock();
    }

    function deleteProduct(id) {
        if (!confirm('Delete this product? This cannot be undone.')) return;
        var products = DB.getProducts().filter(function (p) { return p.id !== id; });
        DB.setProducts(products);
        renderAll();
    }

    function searchProducts(query) {
        var q = sanitize(query).toLowerCase();
        var products = DB.getProducts();
        if (!q) return products;
        return products.filter(function (p) {
            return p.name.toLowerCase().indexOf(q) !== -1;
        });
    }

    function renderProducts() {
        var query = $('search-products').value;
        var products = searchProducts(query);
        var grid = $('products-grid');
        var empty = $('no-products');

        if (products.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        var html = '';
        products.forEach(function (p) {
            var isLow = p.quantity <= 10 && p.quantity > 0;
            var isOut = p.quantity === 0;
            var cardClass = 'product-card' + (isLow ? ' low-stock' : '');

            html += '<div class="' + cardClass + '">';
            html += '<div class="product-name">' + escapeHtml(p.name) + '</div>';
            html += '<div class="product-price">' + formatPrice(p.price) + '</div>';
            html += '<div class="product-stock">Stock: <strong>' + p.quantity + '</strong> pcs</div>';
            html += '<div class="product-actions">';
            html += '<button class="quick-buy-btn" data-id="' + p.id + '" ' + (isOut ? 'disabled' : '') + '>-1</button>';
            html += '<button class="edit-btn" data-id="' + p.id + '">Edit</button>';
            html += '<button class="delete-btn" data-id="' + p.id + '">Del</button>';
            html += '</div>';
            html += '</div>';
        });

        grid.innerHTML = html;
    }

    function renderProductList() {
        var products = DB.getProducts();
        var container = $('product-list-table');
        var empty = $('no-list');
        var count = $('product-count');

        count.textContent = products.length + ' product' + (products.length !== 1 ? 's' : '');

        if (products.length === 0) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        var sorted = products.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

        var html = '';
        html += '<div class="list-table-header">';
        html += '<span>#</span>';
        html += '<span>Name</span>';
        html += '<span>Price</span>';
        html += '<span>Qty</span>';
        html += '</div>';

        sorted.forEach(function (p, i) {
            html += '<div class="list-table-row">';
            html += '<span class="list-row-num">' + (i + 1) + '</span>';
            html += '<span class="list-row-name">' + escapeHtml(p.name) + '</span>';
            html += '<span class="list-row-price">' + formatPrice(p.price) + '</span>';
            html += '<span class="list-row-qty">' + p.quantity + '</span>';
            html += '</div>';
        });

        container.innerHTML = html;
    }

    /* ---------- NOTES ---------- */
    function openNoteModal(editId) {
        var modal = $('note-modal');
        if (editId) {
            var notes = DB.getNotes();
            var note = notes.find(function (n) { return n.id === editId; });
            if (!note) return;
            state.editingNoteId = editId;
            $('note-modal-title').textContent = 'Edit Note';
            $('note-content').value = note.content;
            state.selectedNoteColor = note.color || '#E67E00';
        } else {
            state.editingNoteId = null;
            $('note-modal-title').textContent = 'Add Note';
            $('note-content').value = '';
            state.selectedNoteColor = '#E67E00';
        }

        document.querySelectorAll('.color-swatch').forEach(function (sw) {
            sw.classList.toggle('active', sw.getAttribute('data-color') === state.selectedNoteColor);
        });

        modal.classList.remove('hidden');
        $('note-content').focus();
    }

    function closeNoteModal() {
        $('note-modal').classList.add('hidden');
        state.editingNoteId = null;
    }

    function handleNoteSubmit(e) {
        e.preventDefault();

        var content = sanitize($('note-content').value);
        if (!content) {
            alert('Please enter a note.');
            return;
        }

        var notes = DB.getNotes();

        if (state.editingNoteId) {
            var idx = notes.findIndex(function (n) { return n.id === state.editingNoteId; });
            if (idx !== -1) {
                notes[idx].content = content;
                notes[idx].color = state.selectedNoteColor;
                notes[idx].updatedAt = Date.now();
            }
        } else {
            notes.push({
                id: generateId(),
                content: content,
                color: state.selectedNoteColor,
                createdAt: Date.now()
            });
        }

        DB.setNotes(notes);
        closeNoteModal();
        renderNotes();
    }

    function deleteNote(id) {
        if (!confirm('Delete this note?')) return;
        var notes = DB.getNotes().filter(function (n) { return n.id !== id; });
        DB.setNotes(notes);
        renderNotes();
    }

    function renderNotes() {
        var notes = DB.getNotes();
        var grid = $('notes-grid');
        var empty = $('no-notes');

        if (notes.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        var sorted = notes.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });

        var html = '';
        sorted.forEach(function (n) {
            html += '<div class="note-card" style="border-left-color: ' + escapeHtml(n.color || '#E67E00') + '">';
            html += '<div class="note-card-content">' + escapeHtml(n.content) + '</div>';
            html += '<div class="note-card-footer">';
            html += '<span class="note-date">' + formatDate(n.createdAt) + '</span>';
            html += '<div class="note-card-actions">';
            html += '<button class="note-edit" data-id="' + n.id + '">Edit</button>';
            html += '<button class="note-del" data-id="' + n.id + '">Del</button>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
        });

        grid.innerHTML = html;
    }

    /* ---------- DEBTORS / UTANG ---------- */
    function addDebtorItemRow() {
        var products = DB.getProducts().filter(function (p) { return p.quantity > 0; });
        if (products.length === 0) {
            alert('No products with stock available.');
            return;
        }

        var container = $('debtor-items');
        var rowId = generateId();

        var row = document.createElement('div');
        row.className = 'debtor-item-row';
        row.setAttribute('data-row-id', rowId);

        var selectHtml = '<select class="debtor-item-select" data-row="' + rowId + '">';
        selectHtml += '<option value="">Select product...</option>';
        products.forEach(function (p) {
            selectHtml += '<option value="' + p.id + '" data-price="' + p.price + '" data-name="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + ' (' + formatPrice(p.price) + ')</option>';
        });
        selectHtml += '</select>';

        row.innerHTML = selectHtml +
            '<input type="number" class="debtor-item-qty" data-row="' + rowId + '" placeholder="Qty" min="1" value="1">' +
            '<span class="debtor-item-subtotal" data-row="' + rowId + '">₱0.00</span>' +
            '<button type="button" class="remove-item-btn" data-row="' + rowId + '">✕</button>';

        container.appendChild(row);
    }

    function removeDebtorItemRow(rowId) {
        var row = document.querySelector('[data-row-id="' + rowId + '"]');
        if (row) row.remove();
        recalcDebtorTotal();
    }

    function recalcDebtorTotal() {
        var total = 0;
        document.querySelectorAll('.debtor-item-row').forEach(function (row) {
            var select = row.querySelector('.debtor-item-select');
            var qty = row.querySelector('.debtor-item-qty');
            var subEl = row.querySelector('.debtor-item-subtotal');
            var rowId = row.getAttribute('data-row-id');

            var opt = select.options[select.selectedIndex];
            var price = opt && opt.value ? parseFloat(opt.getAttribute('data-price')) || 0 : 0;
            var quantity = parseInt(qty.value, 10) || 0;
            var sub = price * quantity;

            subEl.textContent = formatPrice(sub);
            total += sub;
        });
        $('debtor-total-amount').textContent = formatPrice(total);
    }

    function saveDebtor() {
        var name = sanitizeName($('debtor-name').value);
        if (!name) {
            alert('Please enter the customer name.');
            return;
        }

        var rows = document.querySelectorAll('.debtor-item-row');
        if (rows.length === 0) {
            alert('Please add at least one item.');
            return;
        }

        var items = [];
        var total = 0;
        var products = DB.getProducts();
        var valid = true;

        rows.forEach(function (row) {
            var select = row.querySelector('.debtor-item-select');
            var qtyInput = row.querySelector('.debtor-item-qty');

            var productId = select.value;
            var quantity = parseInt(qtyInput.value, 10);

            if (!productId) {
                valid = false;
                return;
            }
            if (!quantity || quantity < 1) {
                valid = false;
                return;
            }

            var product = products.find(function (p) { return p.id === productId; });
            if (!product) {
                valid = false;
                return;
            }

            var subtotal = product.price * quantity;
            items.push({
                productId: product.id,
                productName: product.name,
                price: product.price,
                quantity: quantity,
                subtotal: subtotal
            });
            total += subtotal;
        });

        if (!valid || items.length === 0) {
            alert('Please fill in all items correctly.');
            return;
        }

        var debtors = DB.getDebtors();
        debtors.push({
            id: generateId(),
            name: capitalizeWords(name),
            items: items,
            total: Math.round(total * 100) / 100,
            settled: false,
            createdAt: Date.now()
        });
        DB.setDebtors(debtors);

        $('debtor-name').value = '';
        $('debtor-items').innerHTML = '';
        $('debtor-total-amount').textContent = formatPrice(0);

        renderDebtors();
    }

    function payDebtor(id) {
        if (!confirm('Mark this debt as paid?')) return;
        var debtors = DB.getDebtors();
        var idx = debtors.findIndex(function (d) { return d.id === id; });
        if (idx !== -1) {
            debtors[idx].settled = true;
            debtors[idx].paidAt = Date.now();
            DB.setDebtors(debtors);
            renderDebtors();
        }
    }

    function deleteDebtor(id) {
        if (!confirm('Delete this debt record?')) return;
        var debtors = DB.getDebtors().filter(function (d) { return d.id !== id; });
        DB.setDebtors(debtors);
        renderDebtors();
    }

    function renderDebtors() {
        var debtors = DB.getDebtors();
        var list = $('debtors-list');
        var empty = $('no-debtors');

        var unsettled = debtors.filter(function (d) { return !d.settled; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        var settled = debtors.filter(function (d) { return d.settled; }).sort(function (a, b) { return (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt); });
        var all = unsettled.concat(settled);

        if (all.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        var html = '';
        all.forEach(function (d) {
            var cardStyle = d.settled ? 'opacity: 0.6;' : '';
            html += '<div class="debtor-card" style="' + cardStyle + '">';
            html += '<div class="debtor-card-header">';
            html += '<span class="debtor-card-name">' + escapeHtml(d.name) + '</span>';
            html += '<span class="debtor-card-date">' + formatDate(d.createdAt) + '</span>';
            html += '</div>';

            html += '<div class="debtor-card-items">';
            d.items.forEach(function (item) {
                html += '<div class="debtor-card-item">';
                html += '<span class="debtor-card-item-name">' + escapeHtml(item.productName) + ' x' + item.quantity + '</span>';
                html += '<span class="debtor-card-item-detail">' + formatPrice(item.subtotal) + '</span>';
                html += '</div>';
            });
            html += '</div>';

            html += '<div class="debtor-card-footer">';
            if (d.settled) {
                html += '<span class="debtor-card-settled">PAID</span>';
                html += '<button class="btn-danger" data-action="delete-debtor" data-id="' + d.id + '">Remove</button>';
            } else {
                html += '<span class="debtor-card-total">' + formatPrice(d.total) + '</span>';
                html += '<div style="display:flex;gap:8px;">';
                html += '<button class="btn-success" data-action="pay-debtor" data-id="' + d.id + '">Pay All</button>';
                html += '<button class="btn-danger" data-action="delete-debtor" data-id="' + d.id + '">Delete</button>';
                html += '</div>';
            }
            html += '</div>';
            html += '</div>';
        });

        list.innerHTML = html;
    }

    /* ---------- LOW STOCK ---------- */
    function checkLowStock() {
        var products = DB.getProducts();
        var lowItems = products.filter(function (p) { return p.quantity > 0 && p.quantity <= 10; });
        var outItems = products.filter(function (p) { return p.quantity === 0; });

        var alerts = [];
        lowItems.forEach(function (p) {
            if (!state.lowStockNotified.has(p.id + '_low')) {
                alerts.push('"' + p.name + '" has only ' + p.quantity + ' pcs left!');
                state.lowStockNotified.add(p.id + '_low');
            }
        });
        outItems.forEach(function (p) {
            if (!state.lowStockNotified.has(p.id + '_out')) {
                alerts.push('"' + p.name + '" is OUT OF STOCK!');
                state.lowStockNotified.add(p.id + '_out');
            }
        });

        if (alerts.length > 0) {
            $('low-stock-message').textContent = alerts.join(' ');
            $('low-stock-modal').classList.remove('hidden');
        }
    }

    /* ---------- RENDER ALL ---------- */
    function renderAll() {
        renderProducts();
        renderNotes();
        renderDebtors();
        renderProductList();
    }

    /* ---------- SPLASH FLOATING ITEMS ---------- */
    function createFloatingItems() {
        var container = $('floating-items');
        if (!container) return;

        var svgShapes = [
            '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="8" y="15" width="24" height="20" rx="3" fill="#E67E00"/><path d="M14 15V10a6 6 0 0112 0v5" fill="none" stroke="#E67E00" stroke-width="2"/></svg>',
            '<svg viewBox="0 0 40 40" width="36" height="36"><ellipse cx="20" cy="22" rx="10" ry="13" fill="#FF4444"/><path d="M20 9c0-5 5-7 5-7s-1 5-5 7" fill="#44AA44"/></svg>',
            '<svg viewBox="0 0 40 40" width="32" height="32"><rect x="12" y="5" width="16" height="30" rx="4" fill="#5599FF"/><rect x="16" y="10" width="8" height="8" rx="1" fill="#fff" opacity="0.3"/></svg>',
            '<svg viewBox="0 0 40 40" width="38" height="38"><rect x="5" y="12" width="30" height="22" rx="3" fill="#FFD700"/><polygon points="5,12 20,2 35,12" fill="#FFD700"/><rect x="17" y="20" width="6" height="6" rx="1" fill="#1a1a1a"/></svg>',
            '<svg viewBox="0 0 40 40" width="34" height="34"><circle cx="20" cy="20" r="14" fill="#E67E00" opacity="0.8"/><circle cx="15" cy="17" r="2" fill="#1a1a1a"/><circle cx="25" cy="17" r="2" fill="#1a1a1a"/><path d="M14 24c2 3 8 3 12 0" fill="none" stroke="#1a1a1a" stroke-width="1.5"/></svg>',
            '<svg viewBox="0 0 40 40" width="30" height="30"><polygon points="20,2 25,15 39,15 28,24 32,38 20,30 8,38 12,24 1,15 15,15" fill="#FFD700" opacity="0.6"/></svg>',
            '<svg viewBox="0 0 40 40" width="28" height="28"><path d="M20 35s-12-8-12-18a10 10 0 0120 0c0 10-12 18-12 18z" fill="#FF4444" opacity="0.5"/></svg>',
            '<svg viewBox="0 0 40 40" width="36" height="36"><rect x="6" y="10" width="28" height="24" rx="2" fill="#44BB44" opacity="0.6"/><rect x="10" y="6" width="20" height="8" rx="2" fill="#44BB44" opacity="0.6"/></svg>'
        ];

        var html = '';
        for (var i = 0; i < 12; i++) {
            var shape = svgShapes[i % svgShapes.length];
            var left = Math.random() * 90 + 2;
            var top = Math.random() * 85 + 5;
            var dur = 4 + Math.random() * 5;
            var delay = Math.random() * 4;
            var size = 0.6 + Math.random() * 0.8;

            html += '<div class="floating-item" style="left:' + left + '%;top:' + top + '%;animation-duration:' + dur + 's;animation-delay:' + delay + 's;transform:scale(' + size + ')">' + shape + '</div>';
        }
        container.innerHTML = html;
    }

    /* ---------- INSTALL APP ---------- */
    function isStandalone() {
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
        if (navigator.standalone === true) return true;
        return false;
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function updateInstallButton() {
        var btn = $('install-btn');
        if (!btn) return;
        if (isStandalone()) {
            btn.classList.add('hidden');
        } else {
            btn.classList.remove('hidden');
        }
    }

    function showInstallModal() {
        var modal = $('install-modal');
        var promptBox = $('install-android-prompt');
        var manualBox = $('install-android-manual');
        var iosBox = $('install-ios');
        promptBox.classList.add('hidden');
        manualBox.classList.add('hidden');
        iosBox.classList.add('hidden');
        if (deferredInstallPrompt) {
            promptBox.classList.remove('hidden');
        } else if (isIOS()) {
            iosBox.classList.remove('hidden');
        } else {
            manualBox.classList.remove('hidden');
        }
        modal.classList.remove('hidden');
    }

    function installApp() {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then(function (choice) {
                if (choice && choice.outcome === 'accepted') {
                    updateInstallButton();
                }
                deferredInstallPrompt = null;
            });
        } else {
            showInstallModal();
        }
    }

    /* ---------- BACKUP & RESTORE ---------- */
    function openBackupModal() {
        showBackupResult('', '');
        $('backup-modal').classList.remove('hidden');
    }

    function closeBackupModal() {
        $('backup-modal').classList.add('hidden');
    }

    function showBackupResult(msg, type) {
        var el = $('backup-result');
        el.textContent = msg;
        el.className = 'backup-result' + (type ? ' ' + type : '');
    }

    function exportBackup() {
        var payload = {
            app: 'convenience-store',
            version: 1,
            exportedAt: Date.now(),
            data: {
                users: DB.getUsers(),
                products: DB.getProducts(),
                notes: DB.getNotes(),
                debtors: DB.getDebtors()
            }
        };
        var json = JSON.stringify(payload, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'convenience-store-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showBackupResult('Backup downloaded! Keep the file somewhere safe.', 'success');
    }

    function sanitizeBackupData(d) {
        if (!d || !d.data || typeof d.data !== 'object') return null;
        var data = d.data;
        var out = { users: [], products: [], notes: [], debtors: [] };

        function cap(arr, max) {
            return Array.isArray(arr) ? arr.slice(0, max) : [];
        }

        out.users = cap(data.users, 1000).map(function (u) {
            if (!u || typeof u !== 'object') return null;
            var username = sanitizeName(u.username);
            var password = typeof u.password === 'string' ? u.password.substring(0, 128) : '';
            if (!username || !password) return null;
            return {
                id: String(u.id || generateId()),
                username: username,
                password: password,
                createdAt: typeof u.createdAt === 'number' ? u.createdAt : Date.now()
            };
        }).filter(Boolean);

        out.products = cap(data.products, 5000).map(function (p) {
            if (!p || typeof p !== 'object') return null;
            var name = sanitizeName(p.name);
            var price = typeof p.price === 'number' && isFinite(p.price) ? Math.max(0, p.price) : null;
            if (!name || price === null) return null;
            var quantity = typeof p.quantity === 'number' && isFinite(p.quantity) ? Math.max(0, Math.floor(p.quantity)) : 0;
            return {
                id: String(p.id || generateId()),
                name: capitalizeWords(name),
                price: Math.round(price * 100) / 100,
                quantity: quantity,
                createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now()
            };
        }).filter(Boolean);

        out.notes = cap(data.notes, 2000).map(function (n) {
            if (!n || typeof n !== 'object') return null;
            var content = sanitize(n.content);
            if (!content) return null;
            return {
                id: String(n.id || generateId()),
                content: content,
                color: typeof n.color === 'string' ? n.color : '#E67E00',
                createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now()
            };
        }).filter(Boolean);

        out.debtors = cap(data.debtors, 1000).map(function (deb) {
            if (!deb || typeof deb !== 'object') return null;
            var name = sanitizeName(deb.name);
            if (!name) return null;
            var items = cap(deb.items, 200).map(function (it) {
                if (!it || typeof it !== 'object') return null;
                var iname = sanitizeName(it.productName || it.name);
                if (!iname) return null;
                var price = typeof it.price === 'number' && isFinite(it.price) ? Math.max(0, it.price) : 0;
                var qty = typeof it.quantity === 'number' && it.quantity > 0 ? Math.floor(it.quantity) : 1;
                return {
                    productId: String(it.productId || ''),
                    productName: iname,
                    price: price,
                    quantity: qty,
                    subtotal: Math.round(price * qty * 100) / 100
                };
            }).filter(Boolean);
            if (!items.length) return null;
            var summed = Math.round(items.reduce(function (s, it) { return s + it.subtotal; }, 0) * 100) / 100;
            return {
                id: String(deb.id || generateId()),
                name: capitalizeWords(name),
                items: items,
                total: typeof deb.total === 'number' && isFinite(deb.total) ? deb.total : summed,
                settled: !!deb.settled,
                createdAt: typeof deb.createdAt === 'number' ? deb.createdAt : Date.now(),
                paidAt: typeof deb.paidAt === 'number' ? deb.paidAt : undefined
            };
        }).filter(Boolean);

        return out;
    }

    function restoreBackup(data) {
        var clean = sanitizeBackupData(data);
        if (!clean) return false;

        DB.setUsers(clean.users);
        DB.setProducts(clean.products);
        DB.setNotes(clean.notes);
        DB.setDebtors(clean.debtors);

        var current = DB.getCurrentUser();
        if (!current || !clean.users.some(function (u) { return u.id === current.id; })) {
            DB.clearCurrentUser();
        }
        return true;
    }

    function handleBackupFile(file) {
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showBackupResult('File is too large.', 'error');
            return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) {
            var text = String(ev.target.result || '');
            var parsed;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                showBackupResult('Invalid backup file.', 'error');
                return;
            }
            if (!confirm('Restore this backup? It will replace ALL current accounts, products, notes, and debts on this device.')) {
                return;
            }
            var ok = restoreBackup(parsed);
            if (ok) {
                showBackupResult('Backup restored successfully!', 'success');
                setTimeout(function () {
                    closeBackupModal();
                    if (!DB.getCurrentUser()) {
                        authMode = 'login';
                        updateAuthUI();
                        $('main-app').classList.add('hidden');
                        $('auth-screen').classList.remove('hidden');
                    } else {
                        renderAll();
                        checkLowStock();
                    }
                }, 900);
            } else {
                showBackupResult('This file is not a valid backup.', 'error');
            }
        };
        reader.onerror = function () {
            showBackupResult('Could not read the file.', 'error');
        };
        reader.readAsText(file);
    }

    /* ---------- EVENT LISTENERS ---------- */
    function initEvents() {
        $('start-btn').addEventListener('click', function () {
            $('splash-screen').style.transition = 'opacity 0.5s ease';
            $('splash-screen').style.opacity = '0';
            setTimeout(function () {
                $('splash-screen').style.opacity = '1';
                showAuth();
            }, 500);
        });

        $('toggle-auth').addEventListener('click', function (e) {
            e.preventDefault();
            authMode = authMode === 'login' ? 'register' : 'login';
            updateAuthUI();
        });

        $('auth-form').addEventListener('submit', handleAuth);
        $('logout-btn').addEventListener('click', logout);

        document.querySelectorAll('.nav-btn[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchTab(this.getAttribute('data-tab'));
            });
        });

        $('add-product-btn').addEventListener('click', openAddProductModal);
        $('product-form').addEventListener('submit', handleProductSubmit);
        $('cancel-product').addEventListener('click', closeProductModal);

        $('products-grid').addEventListener('click', function (e) {
            var target = e.target;
            if (target.classList.contains('quick-buy-btn')) {
                quickBuy(target.getAttribute('data-id'));
            } else if (target.classList.contains('edit-btn')) {
                openEditProductModal(target.getAttribute('data-id'));
            } else if (target.classList.contains('delete-btn')) {
                deleteProduct(target.getAttribute('data-id'));
            }
        });

        var searchTimeout;
        $('search-products').addEventListener('input', function () {
            clearTimeout(searchTimeout);
            var val = this.value;
            searchTimeout = setTimeout(function () {
                renderProducts();
            }, 200);
        });

        $('floating-note-btn').addEventListener('click', function () {
            openNoteModal();
        });

        $('note-form').addEventListener('submit', handleNoteSubmit);
        $('cancel-note').addEventListener('click', closeNoteModal);

        document.querySelectorAll('.color-swatch').forEach(function (sw) {
            sw.addEventListener('click', function () {
                state.selectedNoteColor = this.getAttribute('data-color');
                document.querySelectorAll('.color-swatch').forEach(function (s) {
                    s.classList.remove('active');
                });
                this.classList.add('active');
            });
        });

        $('notes-grid').addEventListener('click', function (e) {
            var target = e.target;
            if (target.classList.contains('note-edit')) {
                openNoteModal(target.getAttribute('data-id'));
            } else if (target.classList.contains('note-del')) {
                deleteNote(target.getAttribute('data-id'));
            }
        });

        $('add-debtor-item-btn').addEventListener('click', addDebtorItemRow);

        $('debtor-items').addEventListener('click', function (e) {
            if (e.target.classList.contains('remove-item-btn')) {
                removeDebtorItemRow(e.target.getAttribute('data-row'));
            }
        });

        $('debtor-items').addEventListener('input', function (e) {
            if (e.target.classList.contains('debtor-item-select') || e.target.classList.contains('debtor-item-qty')) {
                recalcDebtorTotal();
            }
        });

        $('debtor-items').addEventListener('change', function (e) {
            if (e.target.classList.contains('debtor-item-select')) {
                recalcDebtorTotal();
            }
        });

        $('save-debtor-btn').addEventListener('click', saveDebtor);

        $('debtors-list').addEventListener('click', function (e) {
            var target = e.target;
            var action = target.getAttribute('data-action');
            var id = target.getAttribute('data-id');
            if (action === 'pay-debtor' && id) payDebtor(id);
            if (action === 'delete-debtor' && id) deleteDebtor(id);
        });

        $('close-low-stock').addEventListener('click', function () {
            $('low-stock-modal').classList.add('hidden');
        });

        document.querySelectorAll('.modal-overlay[data-close]').forEach(function (overlay) {
            overlay.addEventListener('click', function () {
                var modalId = this.getAttribute('data-close');
                var modal = $(modalId);
                if (modal) modal.classList.add('hidden');
            });
        });

        $('install-btn').addEventListener('click', installApp);
        $('install-confirm-install').addEventListener('click', function () {
            $('install-modal').classList.add('hidden');
            installApp();
        });
        $('install-cancel').addEventListener('click', function () {
            $('install-modal').classList.add('hidden');
        });
        $('install-manual-ok').addEventListener('click', function () {
            $('install-modal').classList.add('hidden');
        });
        $('install-ios-ok').addEventListener('click', function () {
            $('install-modal').classList.add('hidden');
        });

        window.addEventListener('beforeinstallprompt', function (e) {
            e.preventDefault();
            deferredInstallPrompt = e;
            updateInstallButton();
        });

        window.addEventListener('appinstalled', function () {
            deferredInstallPrompt = null;
            updateInstallButton();
        });

        window.addEventListener('pagehide', function () {
            if (deferredInstallPrompt) deferredInstallPrompt = null;
        });

        $('backup-btn').addEventListener('click', openBackupModal);
        $('backup-export-btn').addEventListener('click', exportBackup);
        $('backup-import-btn').addEventListener('click', function () {
            $('backup-file').click();
        });
        $('backup-file').addEventListener('change', function () {
            var file = this.files && this.files[0];
            this.value = '';
            handleBackupFile(file);
        });
        $('backup-close').addEventListener('click', closeBackupModal);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal:not(.hidden)').forEach(function (m) {
                    m.classList.add('hidden');
                });
            }
        });
    }

    /* ---------- INIT ---------- */
    function init() {
        createFloatingItems();
        initEvents();
        updateInstallButton();

        var user = DB.getCurrentUser();
        if (user) {
            showMainApp();
        } else {
            $('splash-screen').classList.remove('hidden');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
