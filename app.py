from flask import Flask, render_template, request, redirect, url_for, flash
import sqlite3
from datetime import datetime
import math

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            location TEXT NOT NULL,
            description TEXT,
            date_added DATE NOT NULL
        )
    ''')
    
    cursor.execute("SELECT COUNT(*) FROM items")
    count = cursor.fetchone()[0]
    
    if count == 0:
        test_items = [
            ('Ноутбук Lenovo', 'Техника', 5, 'Склад А', 'Рабочие ноутбуки для сотрудников', '2026-01-15'),
            ('Офисный стул', 'Мебель', 12, 'Офис 101', 'Черные, тканевые, кокразябра', '2026-01-20'),
            ('Бумага А4', 'Расходники', 50, 'Склад Б', 'Пачка 500 листов', '2026-01-25'),
            ('Клавиатура Logitech', 'Техника', 8, 'Склад А', 'USB проводные, кокразябра', '2026-02-01'),
            ('Шкаф для документов', 'Мебель', 3, 'Офис 202', 'Металлический', '2026-02-05'),
            ('Ручки шариковые', 'Канцелярия', 100, 'Склад Б', 'Синие, 0.7 мм', '2026-02-10'),
            ('Монитор 24"', 'Техника', 6, 'Склад А', 'Full HD, HDMI, кокразябра', '2026-02-15'),
            ('Степлер', 'Канцелярия', 15, 'Офис 101', 'Красный', '2026-02-20'),
            ('Офисный стол', 'Мебель', 4, 'Офис 202', 'Деревянный', '2026-03-01'),
            ('Тонер для принтера', 'Расходники', 7, 'Склад Б', 'HP 85A', '2026-03-05'),
        ]
        cursor.executemany('''
            INSERT INTO items (name, category, quantity, location, description, date_added)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', test_items)
        conn.commit()
        print("✅ Добавлены тестовые данные")
    
    conn.close()

def get_statistics(items_list):
    """Считает статистику по переданному списку товаров."""
    total = len(items_list)
    total_quantity = sum(item['quantity'] for item in items_list)
    
    # Группировка по категориям
    categories_dict = {}
    for item in items_list:
        cat = item['category']
        if cat in categories_dict:
            categories_dict[cat]['count'] += 1
            categories_dict[cat]['total_quantity'] += item['quantity']
        else:
            categories_dict[cat] = {
                'count': 1,
                'total_quantity': item['quantity']
            }
    
    categories = []
    for cat, data in categories_dict.items():
        categories.append({
            'category': cat,
            'count': data['count'],
            'total_quantity': data['total_quantity']
        })
    
    return {
        'total_items': total,
        'total_quantity': total_quantity,
        'categories': categories
    }

def get_filter_options():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    categories = [row['category'] for row in cursor.execute("SELECT DISTINCT category FROM items ORDER BY category").fetchall()]
    locations = [row['location'] for row in cursor.execute("SELECT DISTINCT location FROM items ORDER BY location").fetchall()]
    
    conn.close()
    return categories, locations

def filter_items(items, filters):
    """Фильтрует список товаров в Python (без учета регистра)."""
    result = items
    
    # Фильтр по категории
    if filters.get('category'):
        result = [item for item in result if item['category'] == filters['category']]
    
    # Фильтр по местоположению
    if filters.get('location'):
        result = [item for item in result if item['location'] == filters['location']]
    
    # Фильтр по минимальному количеству
    if filters.get('min_quantity') and filters['min_quantity'].isdigit():
        min_q = int(filters['min_quantity'])
        result = [item for item in result if item['quantity'] >= min_q]
    
    # === ПОИСК БЕЗ УЧЕТА РЕГИСТРА (работает с кириллицей 100%) ===
    if filters.get('search') and filters['search'].strip():
        search_term = filters['search'].strip().lower()  # Переводим в нижний регистр
        result = [
            item for item in result 
            if search_term in item['name'].lower() or search_term in item['description'].lower()
        ]
    
    return result

def sort_items(items, sort_by, sort_order):
    """Сортирует список товаров."""
    if not items:
        return items
    
    reverse = True if sort_order == 'desc' else False
    
    allowed_sort_fields = ['name', 'category', 'quantity', 'location', 'date_added']
    if sort_by in allowed_sort_fields:
        return sorted(items, key=lambda x: x[sort_by], reverse=reverse)
    else:
        return sorted(items, key=lambda x: x['id'], reverse=True)

@app.route('/')
def index():
    # Получаем параметры из URL
    category = request.args.get('category', '')
    location = request.args.get('location', '')
    min_quantity = request.args.get('min_quantity', '')
    search = request.args.get('search', '')
    sort_by = request.args.get('sort', 'date_added')
    sort_order = request.args.get('order', 'desc')
    page = request.args.get('page', 1, type=int)
    per_page = 5
    
    filters = {
        'category': category,
        'location': location,
        'min_quantity': min_quantity,
        'search': search
    }
    
    # 1. Загружаем ВСЕ товары из БД
    conn = get_db_connection()
    all_items = conn.execute("SELECT * FROM items").fetchall()
    conn.close()
    
    # Преобразуем Row в dict для удобства
    all_items = [dict(item) for item in all_items]
    
    # 2. Фильтруем в Python (с учетом регистра)
    filtered_items = filter_items(all_items, filters)
    
    # 3. Сортируем в Python
    sorted_items = sort_items(filtered_items, sort_by, sort_order)
    
    # 4. Пагинация в Python
    total_items = len(sorted_items)
    total_pages = math.ceil(total_items / per_page) if total_items > 0 else 1
    
    if page < 1:
        page = 1
    if page > total_pages:
        page = total_pages
    
    start = (page - 1) * per_page
    end = start + per_page
    items_page = sorted_items[start:end]
    
    # 5. Статистика
    stats = get_statistics(all_items)  # статистика по ВСЕМ товарам
    
    # 6. Опции для фильтров
    categories, locations = get_filter_options()
    
    return render_template('index.html',
                         items=items_page,
                         categories=categories,
                         locations=locations,
                         current_filters=filters,
                         sort_by=sort_by,
                         sort_order=sort_order,
                         current_page=page,
                         total_pages=total_pages,
                         total_items=total_items,
                         stats=stats)

@app.route('/add', methods=['GET', 'POST'])
def add_item():
    if request.method == 'POST':
        name = request.form['name'].strip()
        category = request.form['category']
        quantity = request.form['quantity']
        location = request.form['location']
        description = request.form.get('description', '').strip()
        date_added = datetime.now().strftime('%Y-%m-%d')
        
        if not name:
            flash('Название товара обязательно!', 'danger')
            return redirect(url_for('add_item'))
        
        if not quantity or not quantity.isdigit() or int(quantity) < 0:
            flash('Количество должно быть положительным числом!', 'danger')
            return redirect(url_for('add_item'))
        
        conn = get_db_connection()
        conn.execute('''
            INSERT INTO items (name, category, quantity, location, description, date_added)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (name, category, int(quantity), location, description, date_added))
        conn.commit()
        conn.close()
        
        flash('Товар успешно добавлен!', 'success')
        return redirect(url_for('index'))
    
    categories, locations = get_filter_options()
    return render_template('add_item.html', categories=categories, locations=locations)

@app.route('/edit/<int:id>', methods=['GET', 'POST'])
def edit_item(id):
    conn = get_db_connection()
    
    if request.method == 'POST':
        name = request.form['name'].strip()
        category = request.form['category']
        quantity = request.form['quantity']
        location = request.form['location']
        description = request.form.get('description', '').strip()
        
        if not name:
            flash('Название товара обязательно!', 'danger')
            return redirect(url_for('edit_item', id=id))
        
        if not quantity or not quantity.isdigit() or int(quantity) < 0:
            flash('Количество должно быть положительным числом!', 'danger')
            return redirect(url_for('edit_item', id=id))
        
        conn.execute('''
            UPDATE items 
            SET name=?, category=?, quantity=?, location=?, description=?
            WHERE id=?
        ''', (name, category, int(quantity), location, description, id))
        conn.commit()
        conn.close()
        
        flash('Товар успешно обновлен!', 'success')
        return redirect(url_for('index'))
    
    item = conn.execute('SELECT * FROM items WHERE id = ?', (id,)).fetchone()
    conn.close()
    
    if not item:
        flash('Товар не найден!', 'danger')
        return redirect(url_for('index'))
    
    categories, locations = get_filter_options()
    return render_template('edit_item.html', item=item, categories=categories, locations=locations)

@app.route('/delete/<int:id>', methods=['POST'])
def delete_item(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM items WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    
    flash('Товар успешно удален!', 'success')
    return redirect(url_for('index'))

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)