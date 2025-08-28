const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { db, getCategories, getCategoryBySlug, listProducts, countProducts, getProductBySlug, createProduct, updateProduct, deleteProduct } = require("./db");
const config = require("./config");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: "parfaite_shop_session_secret_please_change",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 6 } // 6h
}));

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "public", "uploads")),
  filename: (req, file, cb) => {
    const safe = Date.now() + "-" + file.originalname.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    cb(null, safe);
  }
});
const upload = multer({ storage });

// Helpers
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect("/admin/login");
}
function waProductLink(product) {
  const msg = encodeURIComponent(`Bonjour, je suis intéressé(e) par: ${product.title} (Lien: ${reqProtocolHost(req)}/p/${product.slug})`);
  return `https://wa.me/${config.whatsappNumber}?text=${msg}`;
}
function reqProtocolHost(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Globals for views
app.use((req, res, next) => {
  res.locals.siteName = config.siteName;
  res.locals.tagline = config.brandTagline;
  res.locals.signature = config.companySignature;
  res.locals.whatsappNumber = config.whatsappNumber;
  res.locals.whatsappGroupUrl = config.whatsappGroupUrl;
  res.locals.isAuth = !!(req.session && req.session.user);
  res.locals.currentPath = req.path;
  next();
});

// Public routes
app.get("/", (req, res) => {
  const cats = getCategories();
  const products = listProducts({ limit: 12, offset: 0 });
  res.render("index", { categories: cats, featured: products });
});

app.get("/products", (req, res) => {
  const q = (req.query.q || "").trim();
  const cat = (req.query.cat || "").trim();
  const page = Math.max(parseInt(req.query.page || "1"), 1);
  const limit = 24;
  const offset = (page - 1) * limit;
  const categories = getCategories();
  const products = listProducts({ q, categorySlug: cat || undefined, limit, offset });
  const total = countProducts({ q, categorySlug: cat || undefined });
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  res.render("products", { categories, products, q, cat, page, totalPages });
});

app.get("/p/:slug", (req, res) => {
  const product = getProductBySlug(req.params.slug);
  if (!product) return res.status(404).send("Produit introuvable");
  const shareUrl = `${reqProtocolHost(req)}${req.path}`;
  const wa = `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(`Bonjour, je suis intéressé(e) par: ${product.title} (${shareUrl})`)}`;
  res.render("product", { product, shareUrl, wa });
});

app.get("/about", (req, res) => res.render("about"));
app.get("/contact", (req, res) => res.render("contact"));

// Admin routes
app.get("/admin/login", (req, res) => {
  if (req.session.user) return res.redirect("/admin");
  res.render("admin/login", { error: null });
});
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.render("admin/login", { error: "Identifiants invalides" });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.render("admin/login", { error: "Identifiants invalides" });
  req.session.user = { id: user.id, username: user.username };
  res.redirect("/admin");
});
app.get("/admin/logout", (req, res) => { req.session.destroy(() => res.redirect("/admin/login")); });

app.get("/admin", ensureAuth, (req, res) => {
  const products = listProducts({ limit: 100, offset: 0 });
  res.render("admin/dashboard", { products });
});

app.get("/admin/products/new", ensureAuth, (req, res) => {
  res.render("admin/new-product", { categories: getCategories(), error: null });
});

app.post("/admin/products/new", ensureAuth, upload.single("image"), (req, res) => {
  try {
    const { title, description, price, category_slug } = req.body;
    if (!title || !price) throw new Error("Titre et prix requis");
    const cat = category_slug ? getCategoryBySlug(category_slug) : null;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;
    const slug = createProduct({
      title,
      description,
      price: parseInt(price, 10),
      image_path,
      category_id: cat ? cat.id : null
    });
    res.redirect(`/p/${slug}`);
  } catch (e) {
    res.render("admin/new-product", { categories: getCategories(), error: e.message });
  }
});

app.get("/admin/products/:id/edit", ensureAuth, (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.redirect("/admin");
  res.render("admin/edit-product", { product, categories: getCategories(), error: null });
});

app.post("/admin/products/:id/edit", ensureAuth, upload.single("image"), (req, res) => {
  try {
    const { title, description, price, category_slug } = req.body;
    const cat = category_slug ? getCategoryBySlug(category_slug) : null;
    const image_path = req.file ? `/uploads/${req.file.filename}` : undefined;
    const slug = updateProduct(req.params.id, {
      title, description, price: parseInt(price, 10), image_path, category_id: cat ? cat.id : null
    });
    if (!slug) throw new Error("Mise à jour impossible");
    res.redirect(`/p/${slug}`);
  } catch (e) {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
    res.render("admin/edit-product", { product, categories: getCategories(), error: e.message });
  }
});

app.post("/admin/products/:id/delete", ensureAuth, (req, res) => {
  deleteProduct(req.params.id);
  res.redirect("/admin");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Parfaite Shop en ligne sur http://localhost:${PORT}`));
