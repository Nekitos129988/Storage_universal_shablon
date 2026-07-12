/**
 * Фронтенд-логика (vanilla JS).
 * Хэш-роутинг: #/ — список, #/add — создание, #/edit/:id — редактирование.
 * Данные тянутся из REST API через fetch.
 */
const API = '/api';

// --- Состояние фильтров/сортировки/пагинации ---------------------------------
const state = {
	category: '',
	location: '',
	min_quantity: '',
	search: '',
	sort: 'date_added',
	order: 'desc',
	page: 1,
	per_page: 10,
};

// --- Состояние аутентификации -----------------------------------------------
const auth = { user: null };

const isAuthenticated = () => !!auth.user;
/** editor или admin — могут создавать/редактировать/удалять товары. */
const canEdit = () => !!auth.user && (auth.user.role === 'admin' || auth.user.role === 'editor');
const isAdmin = () => !!auth.user && auth.user.role === 'admin';
const roleLabel = (r) => ({ admin: 'Администратор', editor: 'Редактор', viewer: 'Наблюдатель' })[r] || r;
const roleBadgeClass = (r) => (r === 'admin' ? 'badge-danger' : r === 'editor' ? 'badge-warn' : 'badge-ok');

// --- Маленькие хелперы ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const escapeHtml = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

async function api(path, options = {}) {
	const res = await fetch(`${API}${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...options,
	});
	if (res.status === 204) return null;
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		// 401 = сессия истекла/отсутствует → сбрасываем пользователя и отправляем на вход.
		if (res.status === 401) {
			auth.user = null;
			updateNavbar();
			const h = location.hash;
			if (!h.startsWith('#/login') && !h.startsWith('#/register')) {
				location.hash = '#/login';
				flash('Войдите в систему', 'warning');
			}
		}
		const msg = data?.error?.message || `Ошибка ${res.status}`;
		throw new Error(msg);
	}
	return data;
}

function flash(message, type = 'success') {
	const el = document.createElement('div');
	el.className = `alert alert-${type} alert-dismissible fade show`;
	el.setAttribute('role', 'alert');
	el.innerHTML = `${escapeHtml(message)} <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
	$('#flash-container').appendChild(el);
	setTimeout(() => el.remove(), 4000);
}

function buildQuery(extra = {}) {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries({ ...state, ...extra })) {
		if (v !== '' && v != null) params.set(k, v);
	}
	return params.toString();
}

// --- Бейдж количества (приглушённые статусные тона) ------------------------
function quantityBadge(q) {
	let cls = 'badge-ok';
	if (q <= 5) cls = 'badge-danger';
	else if (q <= 20) cls = 'badge-warn';
	return `<span class="badge ${cls}">${q}</span>`;
}

// --- Рендер: список товаров --------------------------------------------------
async function renderList() {
	$('#app').innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
	try {
		const [data, meta] = await Promise.all([
			api(`/items?${buildQuery()}`),
			api('/categories').then((c) => api('/locations').then((l) => ({ ...c, ...l }))),
		]);
		renderListPage(data, meta);
	} catch (e) {
		$('#app').innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message)}</div>`;
	}
}

function renderListPage(data, meta) {
	const { items, pagination: p, stats } = data;
	const sortArrow = (field) =>
		state.sort === field ? `<i class="fas fa-arrow-${state.order === 'asc' ? 'up' : 'down'} sort-arrow"></i>` : '';
	const sortHref = (field) =>
		`#/?${buildQuery({ sort: field, order: state.sort === field && state.order === 'asc' ? 'desc' : 'asc', page: 1 })}`;

	const catBadges = stats.categories
		.map((c) => `<span class="badge badge-soft">${escapeHtml(c.category)} · ${c.total_quantity}</span>`)
		.join(' ');

	const catOptions = meta.categories
		.map((c) => `<option value="${escapeHtml(c)}" ${state.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`)
		.join('');
	const locOptions = meta.locations
		.map((l) => `<option value="${escapeHtml(l)}" ${state.location === l ? 'selected' : ''}>${escapeHtml(l)}</option>`)
		.join('');

	// Кнопки действий (редактировать/удалить) доступны только editor/admin.
	const editAllowed = canEdit();
	const actionsTh = editAllowed ? '<th class="text-center" style="width:90px;">Действия</th>' : '';
	const colspan = editAllowed ? 7 : 6;

	const rows = items.length
		? items
				.map(
					(it) => `
            <tr>
                <td class="text-muted">${it.id}</td>
                <td><strong>${escapeHtml(it.name)}</strong>${it.description ? `<br><small class="text-muted d-none d-md-inline">${escapeHtml(it.description)}</small>` : ''}</td>
                <td class="d-none d-sm-table-cell"><span class="badge badge-soft">${escapeHtml(it.category)}</span></td>
                <td>${quantityBadge(it.quantity)}</td>
                <td class="d-none d-md-table-cell">${escapeHtml(it.location)}</td>
                <td class="d-none d-lg-table-cell text-muted">${escapeHtml(it.date_added)}</td>
                ${
									editAllowed
										? `<td class="text-center" style="white-space:nowrap;">
                    <a href="#/edit/${it.id}" class="btn btn-sm btn-action" title="Редактировать"><i class="fas fa-pen"></i></a>
                    <button class="btn btn-sm btn-action btn-danger" data-del="${it.id}" title="Удалить"><i class="fas fa-trash"></i></button>
                </td>`
										: ''
								}
            </tr>`,
				)
				.join('')
		: `<tr><td colspan="${colspan}" class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x d-block mb-2"></i>Нет товаров, соответствующих фильтрам</td></tr>`;

	// Пагинация
	let pagination = '';
	if (p.total_pages > 1) {
		const prev = p.has_prev
			? `<li class="page-item"><a class="page-link" href="#/?${buildQuery({ page: p.page - 1 })}"><i class="fas fa-chevron-left"></i></a></li>`
			: '';
		const next = p.has_next
			? `<li class="page-item"><a class="page-link" href="#/?${buildQuery({ page: p.page + 1 })}"><i class="fas fa-chevron-right"></i></a></li>`
			: '';
		const nums = Array.from({ length: p.total_pages }, (_, i) => i + 1)
			.map(
				(n) =>
					`<li class="page-item ${n === p.page ? 'active' : ''}"><a class="page-link" href="#/?${buildQuery({ page: n })}">${n}</a></li>`,
			)
			.join('');
		pagination = `<nav class="mt-3 mt-sm-4"><ul class="pagination">${prev}${nums}${next}</ul></nav>`;
	}

	$('#app').innerHTML = `
    <div class="row"><div class="col-12">
        <div class="d-flex align-items-center flex-wrap mb-3 mb-sm-4">
            <h1 class="page-title">
                <span class="d-none d-sm-inline">Список товаров</span>
                <span class="d-inline d-sm-none">Товары</span>
            </h1>
            <span class="count-pill ms-2">${p.total_items} шт.</span>
        </div>
        <div class="row mb-3 mb-sm-4 g-2 g-sm-3">
            <div class="col-6 col-md-3"><div class="stats-card"><span class="stat-accent"></span><p class="stat-label">Всего позиций</p><p class="stat-value">${stats.total_items}</p></div></div>
            <div class="col-6 col-md-3"><div class="stats-card"><span class="stat-accent" style="background:var(--ok)"></span><p class="stat-label">Всего единиц</p><p class="stat-value">${stats.total_quantity}</p></div></div>
            <div class="col-12 col-md-6"><div class="stats-card"><span class="stat-accent" style="background:var(--warn)"></span><p class="stat-label">По категориям</p><div class="d-flex flex-wrap gap-1 gap-sm-2">${catBadges}</div></div></div>
        </div>
        <div class="filter-section">
            <form id="filter-form" class="row g-2 g-sm-3 align-items-end">
                <div class="col-12 col-sm-6 col-md-3"><label class="form-label">Категория</label>
                    <select name="category" class="form-select form-select-sm"><option value="">Все</option>${catOptions}</select></div>
                <div class="col-12 col-sm-6 col-md-3"><label class="form-label">Местоположение</label>
                    <select name="location" class="form-select form-select-sm"><option value="">Все</option>${locOptions}</select></div>
                <div class="col-6 col-sm-3 col-md-2"><label class="form-label">Мин. кол-во</label>
                    <input type="number" name="min_quantity" class="form-control form-control-sm" value="${escapeHtml(state.min_quantity)}" min="0" placeholder="0"></div>
                <div class="col-12 col-sm-6 col-md-3"><label class="form-label">Поиск</label>
                    <input type="text" name="search" class="form-control form-control-sm" placeholder="Название или описание..." value="${escapeHtml(state.search)}"></div>
                <div class="col-6 col-sm-3 col-md-1 d-flex">
                    <button type="submit" class="btn btn-primary btn-sm w-100" title="Применить"><i class="fas fa-filter"></i></button></div>
            </form>
        </div>
        <div class="card"><div class="card-body p-0"><div class="table-responsive">
            <table class="table table-hover mb-0" style="min-width:600px;">
                <thead><tr>
                    <th style="width:44px;">#</th>
                    <th><a href="${sortHref('name')}" class="text-decoration-none text-reset">Название ${sortArrow('name')}</a></th>
                    <th class="d-none d-sm-table-cell"><a href="${sortHref('category')}" class="text-decoration-none text-reset">Категория ${sortArrow('category')}</a></th>
                    <th><a href="${sortHref('quantity')}" class="text-decoration-none text-reset">Кол-во ${sortArrow('quantity')}</a></th>
                    <th class="d-none d-md-table-cell"><a href="${sortHref('location')}" class="text-decoration-none text-reset">Местоположение ${sortArrow('location')}</a></th>
                    <th class="d-none d-lg-table-cell"><a href="${sortHref('date_added')}" class="text-decoration-none text-reset">Дата ${sortArrow('date_added')}</a></th>
                    ${actionsTh}
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div></div></div>
        ${pagination}
        <div class="text-muted small mt-3">Показано ${items.length} из ${p.total_items} записей</div>
    </div></div>`;

	// Обработчик формы фильтров
	$('#filter-form').addEventListener('submit', (e) => {
		e.preventDefault();
		const fd = new FormData(e.target);
		state.category = fd.get('category');
		state.location = fd.get('location');
		state.min_quantity = fd.get('min_quantity');
		state.search = fd.get('search');
		state.page = 1;
		location.hash = `#/?${buildQuery()}`;
	});

	// Обработчики кнопок удаления
	document.querySelectorAll('[data-del]').forEach((btn) => {
		btn.addEventListener('click', () => onDelete(Number(btn.dataset.del)));
	});
}

// --- Удаление через модалку -------------------------------------------------
async function onDelete(id) {
	const modal = new bootstrap.Modal($('#deleteModal'));
	$('#confirm-delete').onclick = async () => {
		try {
			await api(`/items/${id}`, { method: 'DELETE' });
			modal.hide();
			flash('Товар успешно удалён!');
			renderList();
		} catch (e) {
			modal.hide();
			flash(e.message, 'danger');
		}
	};
	modal.show();
}

// --- Рендер: форма добавления/редактирования --------------------------------
function renderForm(mode, item = null) {
	const isEdit = mode === 'edit';
	const heading = isEdit ? `Редактирование товара #${item.id}` : 'Добавление товара';
	const icon = isEdit ? 'pen' : 'plus';
	const btnText = isEdit ? 'Обновить' : 'Сохранить';

	$('#app').innerHTML = `
    <div class="row justify-content-center"><div class="col-12 col-md-8 col-lg-6">
        <div class="mb-3 mb-sm-4">
            <a href="#/" class="text-decoration-none small" style="color:var(--text-muted)">
                <i class="fas fa-arrow-left me-1"></i>К списку товаров
            </a>
            <h1 class="page-title mt-2"><i class="fas fa-${icon} me-1" style="color:var(--accent)"></i>${escapeHtml(heading)}</h1>
        </div>
        <div class="card">
            <div class="card-body">
                <form id="item-form">
                    <div class="row g-2 g-sm-3">
                        <div class="col-12"><label class="form-label">Название товара <span class="req">*</span></label>
                            <input type="text" class="form-control" name="name" value="${item ? escapeHtml(item.name) : ''}" required></div>
                        <div class="col-12 col-sm-6"><label class="form-label">Категория <span class="req">*</span></label>
                            <select class="form-select" name="category" required>${categoryOptions(item?.category)}</select></div>
                        <div class="col-6 col-sm-3"><label class="form-label">Кол-во <span class="req">*</span></label>
                            <input type="number" class="form-control" name="quantity" value="${item ? item.quantity : ''}" min="0" step="1" required></div>
                        <div class="col-6 col-sm-3"><label class="form-label">Место <span class="req">*</span></label>
                            <select class="form-select" name="location" required>${locationOptions(item?.location)}</select></div>
                        <div class="col-12"><label class="form-label">Описание</label>
                            <textarea class="form-control" name="description" rows="3" placeholder="Дополнительная информация...">${item ? escapeHtml(item.description || '') : ''}</textarea></div>
                        <div class="col-12"><hr style="border-color:var(--border)"><div class="d-flex flex-wrap gap-2">
                            <button type="submit" class="btn btn-save"><i class="fas fa-check me-1"></i> ${btnText}</button>
                            <a href="#/" class="btn btn-outline-secondary"><i class="fas fa-times me-1"></i> Отмена</a>
                        </div></div>
                    </div>
                </form>
            </div>
        </div>
    </div></div>`;

	$('#item-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const fd = new FormData(e.target);
		const body = {
			name: fd.get('name').trim(),
			category: fd.get('category'),
			quantity: Number(fd.get('quantity')),
			location: fd.get('location'),
			description: fd.get('description').trim(),
		};
		try {
			if (isEdit) {
				await api(`/items/${item.id}`, { method: 'PUT', body: JSON.stringify(body) });
				flash('Товар успешно обновлён!');
			} else {
				await api('/items', { method: 'POST', body: JSON.stringify(body) });
				flash('Товар успешно добавлен!');
			}
			location.hash = '#/';
		} catch (err) {
			flash(err.message, 'danger');
		}
	});
}

function categoryOptions(selected) {
	const cats = ['Техника', 'Мебель', 'Расходники', 'Канцелярия', 'Другое'];
	return cats.map((c) => `<option value="${c}" ${selected === c ? 'selected' : ''}>${c}</option>`).join('');
}
function locationOptions(selected) {
	const locs = ['Склад А', 'Склад Б', 'Офис 101', 'Офис 202', 'Серверная'];
	return locs.map((l) => `<option value="${l}" ${selected === l ? 'selected' : ''}>${l}</option>`).join('');
}

// --- Навбар в зависимости от состояния входа --------------------------------
function updateNavbar() {
	const toggle = (id, show) => {
		const el = document.getElementById(id);
		if (el) el.classList.toggle('d-none', !show);
	};
	const authed = isAuthenticated();
	toggle('nav-user', authed);
	toggle('nav-logout', authed);
	toggle('nav-login', !authed);
	toggle('nav-register', !authed);
	toggle('nav-admin', isAdmin());
	toggle('nav-add', canEdit());
	if (authed) {
		const nameEl = document.getElementById('nav-username');
		const roleEl = document.getElementById('nav-role');
		if (nameEl) nameEl.textContent = auth.user.username;
		if (roleEl) {
			roleEl.textContent = roleLabel(auth.user.role);
			roleEl.className = 'badge ' + roleBadgeClass(auth.user.role);
		}
	}
}

// --- Страница входа ----------------------------------------------------------
function renderLogin() {
	$('#app').innerHTML = `
    <div class="row justify-content-center"><div class="col-12 col-sm-8 col-md-6 col-lg-5">
        <div class="card"><div class="card-body p-3 p-sm-4">
            <h1 class="page-title text-center"><i class="fas fa-sign-in-alt me-2" style="color:var(--accent)"></i>Вход</h1>
            <form id="auth-form">
                <div class="mb-3"><label class="form-label">Имя пользователя</label>
                    <input type="text" class="form-control" name="username" required autocomplete="username" autofocus></div>
                <div class="mb-3"><label class="form-label">Пароль</label>
                    <input type="password" class="form-control" name="password" required autocomplete="current-password"></div>
                <button type="submit" class="btn btn-save w-100"><i class="fas fa-sign-in-alt me-1"></i> Войти</button>
            </form>
            <div class="text-center mt-3"><small class="text-muted">Нет аккаунта? <a href="#/register">Зарегистрироваться</a></small></div>
        </div></div>
    </div></div>`;

	$('#auth-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const fd = new FormData(e.target);
		try {
			const data = await api('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ username: fd.get('username').trim(), password: fd.get('password') }),
			});
			auth.user = data.user;
			updateNavbar();
			flash(`Добро пожаловать, ${data.user.username}!`);
			location.hash = '#/';
		} catch (err) {
			flash(err.message, 'danger');
		}
	});
}

// --- Страница регистрации ----------------------------------------------------
function renderRegister() {
	$('#app').innerHTML = `
    <div class="row justify-content-center"><div class="col-12 col-sm-8 col-md-6 col-lg-5">
        <div class="card"><div class="card-body p-3 p-sm-4">
            <h1 class="page-title text-center"><i class="fas fa-user-plus me-2" style="color:var(--accent)"></i>Регистрация</h1>
            <form id="auth-form">
                <div class="mb-3"><label class="form-label">Имя пользователя <span class="req">*</span></label>
                    <input type="text" class="form-control" name="username" required minlength="3" autocomplete="username" autofocus></div>
                <div class="mb-3"><label class="form-label">Пароль <span class="req">*</span></label>
                    <input type="password" class="form-control" name="password" required minlength="6" autocomplete="new-password"></div>
                <div class="mb-3"><label class="form-label">Повторите пароль <span class="req">*</span></label>
                    <input type="password" class="form-control" name="confirm" required minlength="6" autocomplete="new-password"></div>
                <button type="submit" class="btn btn-save w-100"><i class="fas fa-user-plus me-1"></i> Зарегистрироваться</button>
            </form>
            <div class="text-center mt-3"><small class="text-muted">Уже есть аккаунт? <a href="#/login">Войти</a></small></div>
            <div class="text-center mt-2"><small class="text-muted">После регистрации учётная запись потребует подтверждения администратора.</small></div>
        </div></div>
    </div></div>`;

	$('#auth-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const fd = new FormData(e.target);
		const username = fd.get('username').trim();
		const password = fd.get('password');
		if (password !== fd.get('confirm')) {
			flash('Пароли не совпадают', 'danger');
			return;
		}
		try {
			await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
			// Сервер НЕ выполняет вход — учётная запись ждёт подтверждения администратора.
			flash('Регистрация принята! Ожидает подтверждения администратора.', 'success');
			location.hash = '#/login';
		} catch (err) {
			flash(err.message, 'danger');
		}
	});
}

// --- Админка: управление пользователями --------------------------------------
async function renderAdmin() {
	$('#app').innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
	try {
		const data = await api('/admin/users');
		renderAdminPage(data.users);
	} catch (e) {
		$('#app').innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message)}</div>`;
	}
}

function renderAdminPage(users) {
	const meId = auth.user.id;
	const pendingCount = users.filter((u) => u.status === 'pending').length;
	const statusBadge = (u) =>
		u.status === 'active'
			? '<span class="badge badge-ok">Активен</span>'
			: '<span class="badge badge-warn">Ожидает</span>';

	const rows = users
		.map((u) => {
			const isSelf = u.id === meId;
			const roleOpts = ['admin', 'editor', 'viewer']
				.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`)
				.join('');
			const approveBtn =
				u.status === 'pending'
					? `<button class="btn btn-sm btn-action approve-user" data-id="${u.id}" title="Подтвердить учётную запись"><i class="fas fa-user-check"></i></button>`
					: '';
			return `<tr>
                <td class="text-muted">${u.id}</td>
                <td><strong>${escapeHtml(u.username)}</strong>${isSelf ? ' <span class="badge badge-soft">это вы</span>' : ''}</td>
                <td>
                    <select class="form-select form-select-sm user-role" data-id="${u.id}" data-orig="${u.role}" ${isSelf ? 'disabled' : ''}>${roleOpts}</select>
                </td>
                <td>${statusBadge(u)}</td>
                <td class="text-muted small d-none d-md-table-cell">${escapeHtml(u.created_at)}</td>
                <td class="text-center" style="white-space:nowrap;">
                    ${approveBtn}
                    <button class="btn btn-sm btn-action save-role" data-id="${u.id}" ${isSelf ? 'disabled' : ''} title="Сохранить роль"><i class="fas fa-check"></i></button>
                    <button class="btn btn-sm btn-action btn-danger del-user" data-id="${u.id}" ${isSelf ? 'disabled' : ''} title="Удалить"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
		})
		.join('');

	const pendingHint = pendingCount
		? `<span class="count-pill ms-2" style="background:var(--warn-bg,var(--warn));color:#fff">${pendingCount} ждёт подтверждения</span>`
		: '';

	$('#app').innerHTML = `
    <div class="row"><div class="col-12">
        <div class="d-flex align-items-center flex-wrap mb-3 mb-sm-4">
            <h1 class="page-title"><i class="fas fa-users-cog me-1" style="color:var(--accent)"></i>Управление пользователями</h1>
            <span class="count-pill ms-2">${users.length} чел.</span>
            ${pendingHint}
        </div>
        <div class="card"><div class="card-body p-0"><div class="table-responsive">
            <table class="table table-hover mb-0" style="min-width:640px;">
                <thead><tr>
                    <th style="width:44px;">#</th>
                    <th>Имя пользователя</th>
                    <th style="width:150px;">Роль</th>
                    <th style="width:100px;">Статус</th>
                    <th class="d-none d-md-table-cell">Создан</th>
                    <th class="text-center" style="width:120px;">Действия</th>
                </tr></thead>
                <tbody>${rows || '<tr><td colspan="6" class="text-center py-4 text-muted">Нет пользователей</td></tr>'}</tbody>
            </table>
        </div></div></div>
        <div class="text-muted small mt-3">Для ожидающего пользователя нажмите <i class="fas fa-user-check"></i> (подтвердить). Смените роль в списке и нажмите <i class="fas fa-check"></i>. Свою роль и роль последнего администратора менять нельзя.</div>
    </div></div>`;

	document
		.querySelectorAll('.approve-user')
		.forEach((btn) => btn.addEventListener('click', () => onApproveUser(Number(btn.dataset.id))));
	document
		.querySelectorAll('.save-role')
		.forEach((btn) => btn.addEventListener('click', () => onSaveRole(btn.dataset.id)));
	document
		.querySelectorAll('.del-user')
		.forEach((btn) => btn.addEventListener('click', () => onDeleteUser(Number(btn.dataset.id))));
}

async function onApproveUser(id) {
	try {
		await api(`/admin/users/${id}/approve`, { method: 'POST' });
		flash('Учётная запись подтверждена — пользователь может войти');
		renderAdmin();
	} catch (e) {
		flash(e.message, 'danger');
	}
}

async function onSaveRole(id) {
	const sel = document.querySelector(`.user-role[data-id="${id}"]`);
	if (!sel) return;
	const newRole = sel.value;
	try {
		await api(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ role: newRole }) });
		sel.dataset.orig = newRole;
		flash('Роль пользователя обновлена');
	} catch (e) {
		sel.value = sel.dataset.orig; // откатываем выбор
		flash(e.message, 'danger');
	}
}

async function onDeleteUser(id) {
	if (!confirm('Удалить этого пользователя? Действие нельзя отменить.')) return;
	try {
		await api(`/admin/users/${id}`, { method: 'DELETE' });
		flash('Пользователь удалён');
		renderAdmin();
	} catch (e) {
		flash(e.message, 'danger');
	}
}

// --- Выход -------------------------------------------------------------------
async function onLogout() {
	try {
		await api('/auth/logout', { method: 'POST' });
	} catch {
		/* даже если запрос упал — сбрасываем локальное состояние */
	}
	auth.user = null;
	updateNavbar();
	flash('Вы вышли из системы');
	location.hash = '#/login';
}

// --- Хэш-роутинг -------------------------------------------------------------
async function router() {
	const hash = location.hash.replace(/^#\/?/, ''); // убираем '#/' или '#'
	const [path, queryString] = hash.split('?');

	// --- Защита маршрутов ---------------------------------------------------
	// Вошедший пользователь не видит страницы входа/регистрации.
	if ((path === 'login' || path === 'register') && isAuthenticated()) {
		location.hash = '#/';
		return;
	}
	// Весь сайт (кроме страниц входа/регистрации) требует аутентификации.
	if (!isAuthenticated() && path !== 'login' && path !== 'register') {
		location.hash = '#/login';
		return;
	}
	// Админка доступна только администратору.
	if (path === 'admin' && !isAdmin()) {
		flash('Недостаточно прав для доступа к разделу администрирования', 'danger');
		location.hash = '#/';
		return;
	}

	// --- Вспомогательные маршруты (ранний выход) ----------------------------
	if (path === 'login') {
		renderLogin();
		return;
	}
	if (path === 'register') {
		renderRegister();
		return;
	}
	if (path === 'admin') {
		renderAdmin();
		return;
	}

	// --- Парсим query-параметры в состояние (для списка товаров) ------------
	const params = new URLSearchParams(queryString || '');
	state.category = params.get('category') || '';
	state.location = params.get('location') || '';
	state.min_quantity = params.get('min_quantity') || '';
	state.search = params.get('search') || '';
	state.sort = params.get('sort') || 'date_added';
	state.order = params.get('order') || 'desc';
	state.page = Number(params.get('page')) || 1;

	if (path === 'add') {
		if (!canEdit()) {
			flash('Недостаточно прав для добавления товаров', 'danger');
			location.hash = '#/';
			return;
		}
		renderForm('add');
	} else if (path.startsWith('edit/')) {
		if (!canEdit()) {
			flash('Недостаточно прав для редактирования', 'danger');
			location.hash = '#/';
			return;
		}
		const id = Number(path.split('/')[1]);
		try {
			const item = await api(`/items/${id}`);
			renderForm('edit', item);
		} catch (e) {
			flash(e.message, 'danger');
			location.hash = '#/';
		}
	} else {
		renderList();
	}
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
	// Перед первым роутом — определяем состояние аутентификации по cookie.
	try {
		const data = await api('/auth/me');
		auth.user = data.user;
	} catch {
		auth.user = null;
	}
	updateNavbar();

	// Обработчик кнопки выхода в навбаре.
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) logoutBtn.addEventListener('click', onLogout);

	router();
});
