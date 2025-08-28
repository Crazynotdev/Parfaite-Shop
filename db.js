const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const slugify = require("slugify");
const { adminDefault } = require("./config");

const db = new Database("data.db");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  image_path TEXT,
  category_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);
`);

function seed() {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(adminDefault.username);
  if (!user) {
    const hash = bcrypt.hashSync(adminDefault.password, 10);
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(adminDefault.username, hash);
    console.log("Admin seed -> username:", adminDefault.username);
  }
  const countCat = db.prepare("SELECT COUNT(*) as c FROM categories").get().c;
  if (countCat === 0) {
    const cats = ["Électronique","Vêtements","Beauté","Maison","Accessoires","Supermarché"];
    const ins = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)");
    const trx = db.transaction((arr) => arr.forEach(n => ins.run(n, slugify(n, { lower: true, strict: true })) ));
    trx(cats);
    console.log("Catégories seedées");
  }
}
seed();

module.exports = {
  db,
  getCategories: () => db.prepare("SELECT * FROM categories ORDER BY name").all(),
  getCategoryBySlug: (slug) => db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug),
  listProducts: ({ q, categorySlug, limit = 24, offset = 0 }) => {
    let sql = `
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1`;
    const params = [];
    if (q) { sql += " AND p.title LIKE ?"; params.push(`%${q}%`); }
    if (categorySlug) { sql += " AND c.slug = ?"; params.push(categorySlug); }
    sql += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  },
  countProducts: ({ q, categorySlug }) => {
    let sql = `SELECT COUNT(*) as c FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1`;
    const params = [];
    if (q) { sql += " AND p.title LIKE ?"; params.push(`%${q}%`); }
    if (categorySlug) { sql += " AND c.slug = ?"; params.push(categorySlug); }
    return db.prepare(sql).get(...params).c;
  },
  getProductBySlug: (slug) => db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.slug = ?
  `).get(slug),
  createProduct: ({ title, description, price, image_path, category_id }) => {
    const slug = slugify(title, { lower: true, strict: true }) + "-" + Date.now().toString(36);
    db.prepare(`INSERT INTO products (title, slug, description, price, image_path, category_id)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(title, slug, description, price, image_path, category_id || null);
    return slug;
  },
  updateProduct: (id, { title, description, price, image_path, category_id }) => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) return false;
    const slug = title !== product.title
      ? slugify(title, { lower: true, strict: true }) + "-" + Date.now().toString(36)
      : product.slug;
    db.prepare(`UPDATE products SET title=?, slug=?, description=?, price=?, image_path=?, category_id=?
                WHERE id=?`)
      .run(title, slug, description, price, image_path || product.image_path, category_id || null, id);
    return slug;
  },
  deleteProduct: (id) => db.prepare("DELETE FROM products WHERE id = ?").run(id)
};
