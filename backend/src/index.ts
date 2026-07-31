import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { runMigrations } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { requirePlatformAdmin, requireMerchant } from "./middleware/staff.js";
import { errorHandler } from "./middleware/error.js";
import { authRouter } from "./modules/auth.js";
import { staffAuthRouter } from "./modules/staff-auth.js";
import { catalogRouter } from "./modules/catalog.js";
import { cardsRouter } from "./modules/cards.js";
import { ordersRouter } from "./modules/orders.js";
import { adminRouter } from "./modules/admin.js";
import { merchantRouter } from "./modules/merchant.js";
import { integrationRouter } from "./modules/integration.js";

const app = express();

// Las tres apps se sirven desde su propio subdominio y cada una proxea /api al
// mismo origen (Nginx en producción, el proxy de Vite en desarrollo). O sea que
// el navegador nunca cruza de origen y CORS no hace falta en ningún entorno.
//
// Se deja el middleware con una lista explícita —y no abierto— para que, si
// algún día aparece un cliente que sí necesite cross-origin, haya que
// habilitarlo a propósito en vez de descubrir que ya estaba permitido.
app.use(cors({ origin: [config.publicUrl] }));
app.use(express.json({ limit: "2mb" })); // los lotes de catálogo pesan

app.get("/health", (_req, res) => res.json({ ok: true }));

// ── Compradores ──────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/catalog", catalogRouter);          // público: se mira sin cuenta
app.use("/api/cards", requireAuth, cardsRouter);
app.use("/api/orders", requireAuth, ordersRouter);

// ── Back-office ──────────────────────────────────────────────────────────────
// Los guards van montados acá y no dentro de cada router: así no existe la
// posibilidad de agregar un endpoint nuevo y olvidarse de protegerlo.
app.use("/api/staff", staffAuthRouter);                     // login de back-office
app.use("/api/admin", requirePlatformAdmin, adminRouter);   // sólo plataforma
app.use("/api/merchant", requireMerchant, merchantRouter);  // sólo comercios

// ── Integración de los comercios ─────────────────────────────────────────────
// Versionada porque acá romper la compatibilidad le rompe el cron a alguien.
// Cada endpoint declara qué scope de la API key necesita.
app.use("/api/v1", integrationRouter);

app.use(errorHandler);

async function main() {
  await runMigrations();
  app.listen(config.port, config.host, () => {
    console.log(`Bankstore backend escuchando en http://${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
