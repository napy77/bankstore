/**
 * Carga los datos del prototipo en la base.
 *
 * Lee directamente los archivos del frontend (src/data/*.ts) para que no haya
 * dos copias del catálogo que se desincronicen. Es idempotente: se puede
 * correr las veces que haga falta.
 *
 *   npm run seed
 *
 * Los porcentajes del frontend vienen como enteros (15 = 15%) y en la base van
 * como fracción (0.15). La conversión pasa acá, una sola vez.
 */
import bcrypt from "bcryptjs";
import { pool, runMigrations } from "./db.js";
import { BANKS, INITIAL_CARDS } from "../../src/data/banks.js";
import { PRODUCTS } from "../../src/data/products.js";

const CATEGORIES: Record<string, string> = {
  tecnologia: "Tecnología",
  electrohogar: "Electrohogar",
  turismo: "Turismo / Viajes",
  deportes: "Deportes",
  moda: "Moda",
};

const DEMO_USER = {
  email: process.env.SEED_EMAIL ?? "demo@bankstore.test",
  password: process.env.SEED_PASSWORD ?? "bankstore2026",
  name: "German Yovan",
};

async function seed() {
  await runMigrations();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [id, name] of Object.entries(CATEGORIES)) {
      await client.query(
        `INSERT INTO product_categories (id, name) VALUES ($1,$2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [id, name]
      );
    }
    console.log(`[seed] ${Object.keys(CATEGORIES).length} categorías`);

    for (const bank of BANKS) {
      await client.query(
        `INSERT INTO banks (id, name, logo_color, accent_color, text_color) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, logo_color = EXCLUDED.logo_color,
           accent_color = EXCLUDED.accent_color, text_color = EXCLUDED.text_color`,
        [bank.id, bank.name, bank.logoColor, bank.accentColor, bank.textColor]
      );
      for (const promo of bank.promos) {
        await client.query(
          `INSERT INTO bank_promos (bank_id, category_id, max_cuotas, discount_percent, cap_amount, description)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (bank_id, category_id) DO UPDATE SET
             max_cuotas = EXCLUDED.max_cuotas, discount_percent = EXCLUDED.discount_percent,
             cap_amount = EXCLUDED.cap_amount, description = EXCLUDED.description`,
          [bank.id, promo.category, promo.maxCuotas, promo.discountPercent / 100,
           promo.capAmount ?? null, promo.description]
        );
      }
    }
    console.log(`[seed] ${BANKS.length} bancos y sus promos`);

    for (const p of PRODUCTS) {
      await client.query(
        `INSERT INTO products (id, name, description, price, original_price, category_id,
                               rating, reviews_count, image, stock, specs, features)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
           original_price = EXCLUDED.original_price, category_id = EXCLUDED.category_id,
           rating = EXCLUDED.rating, reviews_count = EXCLUDED.reviews_count,
           image = EXCLUDED.image, stock = EXCLUDED.stock, specs = EXCLUDED.specs,
           features = EXCLUDED.features, updated_at = now()`,
        [p.id, p.name, p.description, p.price, p.originalPrice ?? null, p.category,
         p.rating, p.reviewsCount, p.image, p.stock,
         JSON.stringify(p.specs ?? []), JSON.stringify(p.features ?? [])]
      );
      for (const offer of p.bankOffers) {
        await client.query(
          `INSERT INTO product_bank_offers (product_id, bank_id, max_cuotas, discount_percent, extra_reintegro_percent)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (product_id, bank_id) DO UPDATE SET
             max_cuotas = EXCLUDED.max_cuotas, discount_percent = EXCLUDED.discount_percent,
             extra_reintegro_percent = EXCLUDED.extra_reintegro_percent`,
          [p.id, offer.bankId, offer.maxCuotas, offer.discountPercent / 100,
           (offer.extraReintegroPercent ?? 0) / 100]
        );
      }
    }
    console.log(`[seed] ${PRODUCTS.length} productos y sus ofertas`);

    // Usuario de prueba con la billetera del prototipo
    const hash = await bcrypt.hash(DEMO_USER.password, 12);
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [DEMO_USER.email, hash, DEMO_USER.name]
    );

    for (const card of INITIAL_CARDS) {
      const last4 = card.cardNumber.slice(-4);
      const [mm, yy] = card.expiryDate.split("/");
      await client.query(
        `INSERT INTO cards (user_id, bank_id, display_name, holder_name, last4, brand, tier,
                            expiry_month, expiry_year, credit_limit, available_limit, color_theme)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (user_id, bank_id, last4, brand) DO UPDATE SET
           credit_limit = EXCLUDED.credit_limit, available_limit = EXCLUDED.available_limit`,
        [user.id, card.bankId, card.bankName, card.holderName, last4, card.brand, card.tier,
         Number(mm), 2000 + Number(yy), card.limit, card.availableLimit, card.colorTheme]
      );
    }
    console.log(`[seed] usuario ${DEMO_USER.email} con ${INITIAL_CARDS.length} tarjetas`);

    await client.query("COMMIT");
    console.log(`\n✓ Listo. Entrá con ${DEMO_USER.email} / ${DEMO_USER.password}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
