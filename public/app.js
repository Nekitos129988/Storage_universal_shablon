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

// --- Маленькие хелперы ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
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

    const catOptions = meta.categories.map((c) => `<option value="${escapeHtml(c)}" ${state.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    const locOptions = meta.locations.map((l) => `<option value="${escapeHtml(l)}" ${state.location === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');

    const rows = items.length
        ? items.map((it) => `
            <tr>
                <td class="text-muted">${it.id}</td>
                <td><strong>${escapeHtml(it.name)}</strong>${it.description ? `<br><small class="text-muted d-none d-md-inline">${escapeHtml(it.description)}</small>` : ''}</td>
                <td class="d-none d-sm-table-cell"><span class="badge badge-soft">${escapeHtml(it.category)}</span></td>
                <td>${quantityBadge(it.quantity)}</td>
                <td class="d-none d-md-table-cell">${escapeHtml(it.location)}</td>
                <td class="d-none d-lg-table-cell text-muted">${escapeHtml(it.date_added)}</td>
                <td class="text-center" style="white-space:nowrap;">
                    <a href="#/edit/${it.id}" class="btn btn-sm btn-action" title="Редактировать"><i class="fas fa-pen"></i></a>
                    <button class="btn btn-sm btn-action btn-danger" data-del="${it.id}" title="Удалить"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`).join('')
        : `<tr><td colspan="7" class="text-center py-5 text-muted"><i class="fas fa-inbox fa-2x d-block mb-2"></i>Нет товаров, соответствующих фильтрам</td></tr>`;

    // Пагинация
    let pagination = '';
    if (p.total_pages > 1) {
        const prev = p.has_prev ? `<li class="page-item"><a class="page-link" href="#/?${buildQuery({ page: p.page - 1 })}"><i class="fas fa-chevron-left"></i></a></li>` : '';
        const next = p.has_next ? `<li class="page-item"><a class="page-link" href="#/?${buildQuery({ page: p.page + 1 })}"><i class="fas fa-chevron-right"></i></a></li>` : '';
        const nums = Array.from({ length: p.total_pages }, (_, i) => i + 1)
            .map((n) => `<li class="page-item ${n === p.page ? 'active' : ''}"><a class="page-link" href="#/?${buildQuery({ page: n })}">${n}</a></li>`)
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
                    <th class="text-center" style="width:90px;">Действия</th>
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

// --- Хэш-роутинг -------------------------------------------------------------
async function router() {
    const hash = location.hash.replace(/^#\/?/, ''); // убираем '#/' или '#'
    const [path, queryString] = hash.split('?');

    // Парсим query-параметры в состояние
    const params = new URLSearchParams(queryString || '');
    state.category = params.get('category') || '';
    state.location = params.get('location') || '';
    state.min_quantity = params.get('min_quantity') || '';
    state.search = params.get('search') || '';
    state.sort = params.get('sort') || 'date_added';
    state.order = params.get('order') || 'desc';
    state.page = Number(params.get('page')) || 1;

    if (path === 'add') {
        renderForm('add');
    } else if (path.startsWith('edit/')) {
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
window.addEventListener('DOMContentLoaded', router);
