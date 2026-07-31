/**
 * Comercios, usuarios de back-office y acuerdos de ejemplo.
 *
 *   npm run seed:marketplace
 *
 * Idempotente: se puede correr las veces que haga falta. No toca órdenes ni
 * compradores; sólo da de alta o refresca la estructura del marketplace.
 *
 * Corre ANTES de `npm run seed`: crea las categorías, los bancos y los
 * comercios que el catálogo necesita para poder publicarse.
 */
import bcrypt from "bcryptjs";
import { pool, runMigrations } from "./db.js";
import { generateApiKey } from "./middleware/apikey.js";
import { BANKS } from "../../apps/tienda/src/data/banks.js";

const CATEGORIAS: [string, string, string | null][] = [
  ["tecnologia", "Tecnología", null],
  ["electrohogar", "Electrohogar", null],
  ["turismo", "Turismo / Viajes", null],
  ["deportes", "Deportes", null],
  ["moda", "Moda", null],
  ["ferreteria", "Ferretería", null],
  ["herramientas", "Herramientas", "ferreteria"],
  ["construccion", "Construcción", "ferreteria"],
  ["hoteleria", "Hotelería", "turismo"],
  ["bienestar", "Spa y Bienestar", null],
];

interface ComercioSeed {
  id: string;
  legalName: string;
  tradeName: string;
  categories: string[];
  commission: number;          // fracción
  absorbsInstallmentCost: boolean;
  settlementDays: number;
}

const COMERCIOS: ComercioSeed[] = [
  { id: "electro-1", legalName: "Electrohogar del Sur S.A.", tradeName: "Electro Sur",
    categories: ["tecnologia", "electrohogar"], commission: 0.08, absorbsInstallmentCost: true, settlementDays: 30 },
  { id: "electro-2", legalName: "Mundo Digital S.R.L.", tradeName: "Mundo Digital",
    categories: ["tecnologia", "electrohogar"], commission: 0.10, absorbsInstallmentCost: true, settlementDays: 21 },
  { id: "ferreteria-1", legalName: "Ferretería Industrial Rivas S.A.", tradeName: "Ferretería Rivas",
    categories: ["ferreteria", "herramientas", "construccion"], commission: 0.07, absorbsInstallmentCost: true, settlementDays: 30 },
  { id: "ferreteria-2", legalName: "Corralón Norte S.R.L.", tradeName: "Corralón Norte",
    categories: ["ferreteria", "construccion"], commission: 0.06, absorbsInstallmentCost: false, settlementDays: 45 },
  { id: "viajes-1", legalName: "Turismo Andes S.A.", tradeName: "Andes Viajes",
    categories: ["turismo"], commission: 0.12, absorbsInstallmentCost: true, settlementDays: 60 },
  { id: "viajes-2", legalName: "Patagonia Travel S.R.L.", tradeName: "Patagonia Travel",
    categories: ["turismo"], commission: 0.12, absorbsInstallmentCost: true, settlementDays: 60 },
  { id: "spa-1", legalName: "Bienestar Integral S.A.", tradeName: "Aqua Spa",
    categories: ["bienestar"], commission: 0.15, absorbsInstallmentCost: true, settlementDays: 15 },
  { id: "hotel-1", legalName: "Hotelería Cordillera S.A.", tradeName: "Hotel Cordillera",
    categories: ["hoteleria", "turismo"], commission: 0.14, absorbsInstallmentCost: true, settlementDays: 45 },
  { id: "hotel-2", legalName: "Costa Hoteles S.R.L.", tradeName: "Hotel Costa Azul",
    categories: ["hoteleria", "turismo"], commission: 0.14, absorbsInstallmentCost: true, settlementDays: 45 },
  { id: "hotel-3", legalName: "Urbano Suites S.A.", tradeName: "Urbano Suites",
    categories: ["hoteleria"], commission: 0.13, absorbsInstallmentCost: true, settlementDays: 30 },
];

/** Acuerdos de ejemplo que muestran cómo juega la especificidad. */
const ACUERDOS: {
  bank: string; merchant: string | null; category: string | null;
  cuotas: number; reintegro: number; cap: number | null; desc: string; priority?: number;
}[] = [
  // Global del banco: el piso para cualquier comercio.
  { bank: "galicia", merchant: null, category: null, cuotas: 3, reintegro: 0,
    cap: null, desc: "3 cuotas sin interés en todo el marketplace" },
  // Por categoría, para todos los comercios.
  { bank: "ciudad", merchant: null, category: "ferreteria", cuotas: 12, reintegro: 0.10,
    cap: 30000, desc: "12 cuotas sin interés y 10% en Ferretería" },
  // Exclusivo de un comercio: le gana al global aunque dé lo mismo o menos.
  { bank: "galicia", merchant: "electro-1", category: null, cuotas: 18, reintegro: 0.20,
    cap: 80000, desc: "Exclusivo Electro Sur: 18 cuotas y 20% de reintegro" },
  // Comercio + categoría: lo más específico que hay.
  { bank: "galicia", merchant: "electro-1", category: "tecnologia", cuotas: 24, reintegro: 0.25,
    cap: 100000, desc: "Electro Sur Tecno: 24 cuotas y 25% de reintegro" },
  { bank: "bna", merchant: "ferreteria-1", category: null, cuotas: 15, reintegro: 0.12,
    cap: 40000, desc: "Nación en Ferretería Rivas: 15 cuotas y 12%" },
  { bank: "macro", merchant: "hotel-1", category: null, cuotas: 12, reintegro: 0.18,
    cap: 120000, desc: "Macro Selecta en Hotel Cordillera: 12 cuotas y 18%" },
  { bank: "provincia", merchant: "viajes-1", category: null, cuotas: 18, reintegro: 0.15,
    cap: 150000, desc: "Provincia en Andes Viajes: 18 cuotas sin interés" },
];

const PLATFORM_ADMIN = {
  email: process.env.ADMIN_EMAIL ?? "admin@bankstore.test",
  password: process.env.ADMIN_PASSWORD ?? "bankstore-admin-2026",
  name: "Administrador Bankstore",
};

const MERCHANT_PASSWORD = process.env.MERCHANT_PASSWORD ?? "comercio-2026-demo";

async function seed() {
  await runMigrations();
  const client = await pool.connect();
  const clavesGeneradas: { merchant: string; key: string }[] = [];

  try {
    await client.query("BEGIN");

    for (const [id, name, parent] of CATEGORIAS) {
      await client.query(
        `INSERT INTO product_categories (id, name, parent_id) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id`,
        [id, name, parent]
      );
    }
    console.log(`[seed] ${CATEGORIAS.length} categorías`);

    // Los bancos y sus promos generales. Van acá y no en el seed del catálogo
    // porque son estructura de la plataforma —igual que las categorías y los
    // comercios— y porque los acuerdos de más abajo los referencian.
    for (const bank of BANKS) {
      await client.query(
        `INSERT INTO banks (id, name, logo_color, accent_color, text_color) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, logo_color = EXCLUDED.logo_color,
           accent_color = EXCLUDED.accent_color, text_color = EXCLUDED.text_color`,
        [bank.id, bank.name, bank.logoColor, bank.accentColor, bank.textColor]
      );
      // Las promos del prototipo entran como acuerdos GLOBALES por categoría
      // (merchant_id NULL): valen para todos los comercios.
      for (const promo of bank.promos) {
        await client.query(
          `INSERT INTO bank_agreements (bank_id, merchant_id, category_id, max_cuotas,
                                        discount_percent, cap_amount, description)
           VALUES ($1,NULL,$2,$3,$4,$5,$6)
           ON CONFLICT (bank_id, merchant_id, category_id) DO UPDATE SET
             max_cuotas = EXCLUDED.max_cuotas, discount_percent = EXCLUDED.discount_percent,
             cap_amount = EXCLUDED.cap_amount, description = EXCLUDED.description`,
          [bank.id, promo.category, promo.maxCuotas, promo.discountPercent / 100,
           promo.capAmount ?? null, promo.description]
        );
      }
    }
    console.log(`[seed] ${BANKS.length} bancos y sus acuerdos globales`);

    for (const c of COMERCIOS) {
      await client.query(
        `INSERT INTO merchants (id, legal_name, trade_name, status, commission_percent,
                                absorbs_installment_cost, settlement_days, contact_email)
         VALUES ($1,$2,$3,'active',$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           legal_name = EXCLUDED.legal_name, trade_name = EXCLUDED.trade_name,
           commission_percent = EXCLUDED.commission_percent,
           absorbs_installment_cost = EXCLUDED.absorbs_installment_cost,
           settlement_days = EXCLUDED.settlement_days, updated_at = now()`,
        [c.id, c.legalName, c.tradeName, c.commission, c.absorbsInstallmentCost,
         c.settlementDays, `contacto@${c.id}.test`]
      );
      for (const cat of c.categories) {
        await client.query(
          "INSERT INTO merchant_categories VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [c.id, cat]
        );
      }
    }
    console.log(`[seed] ${COMERCIOS.length} comercios activos`);

    // Administrador de plataforma
    const adminHash = await bcrypt.hash(PLATFORM_ADMIN.password, 12);
    await client.query(
      `INSERT INTO staff_users (email, password_hash, name, role, merchant_id)
       VALUES ($1,$2,$3,'platform_admin',NULL)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
      [PLATFORM_ADMIN.email, adminHash, PLATFORM_ADMIN.name]
    );

    // Un administrador por comercio
    const merchantHash = await bcrypt.hash(MERCHANT_PASSWORD, 12);
    for (const c of COMERCIOS) {
      await client.query(
        `INSERT INTO staff_users (email, password_hash, name, role, merchant_id)
         VALUES ($1,$2,$3,'merchant_admin',$4)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
        [`admin@${c.id}.test`, merchantHash, `Admin ${c.tradeName}`, c.id]
      );
    }
    console.log(`[seed] 1 admin de plataforma y ${COMERCIOS.length} de comercio`);

    for (const a of ACUERDOS) {
      await client.query(
        `INSERT INTO bank_agreements (bank_id, merchant_id, category_id, max_cuotas,
                                      discount_percent, cap_amount, description, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (bank_id, merchant_id, category_id) DO UPDATE SET
           max_cuotas = EXCLUDED.max_cuotas, discount_percent = EXCLUDED.discount_percent,
           cap_amount = EXCLUDED.cap_amount, description = EXCLUDED.description`,
        [a.bank, a.merchant, a.category, a.cuotas, a.reintegro, a.cap, a.desc, a.priority ?? 0]
      );
    }
    console.log(`[seed] ${ACUERDOS.length} acuerdos bancarios`);

    // Una API key por comercio, sólo si todavía no tiene ninguna activa. El
    // secreto no se puede recuperar, así que regenerarlo en cada corrida
    // rompería la integración de un comercio que ya la tenga configurada.
    for (const c of COMERCIOS) {
      const { rows: existentes } = await client.query(
        "SELECT 1 FROM merchant_api_keys WHERE merchant_id = $1 AND revoked_at IS NULL",
        [c.id]
      );
      if (existentes[0]) continue;
      const key = generateApiKey();
      await client.query(
        `INSERT INTO merchant_api_keys (merchant_id, name, key_prefix, key_hash)
         VALUES ($1,'Clave inicial de integración',$2,$3)`,
        [c.id, key.prefix, key.hash]
      );
      clavesGeneradas.push({ merchant: c.id, key: key.plaintext });
    }

    await client.query("COMMIT");

    console.log("\n┌─ Acceso al back-office ────────────────────────────────────────");
    console.log(`│ Plataforma : ${PLATFORM_ADMIN.email} / ${PLATFORM_ADMIN.password}`);
    console.log(`│ Comercios  : admin@<comercio>.test / ${MERCHANT_PASSWORD}`);
    console.log(`│              por ejemplo admin@electro-1.test`);
    console.log("└────────────────────────────────────────────────────────────────");

    if (clavesGeneradas.length) {
      console.log("\n┌─ API keys generadas (se muestran UNA sola vez) ────────────────");
      for (const k of clavesGeneradas) {
        console.log(`│ ${k.merchant.padEnd(14)} ${k.key}`);
      }
      console.log("└────────────────────────────────────────────────────────────────");
    } else {
      console.log("\n(los comercios ya tenían claves activas: no se generaron nuevas)");
    }
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
