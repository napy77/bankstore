import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { runMigrations } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { authRouter } from "./modules/auth.js";
import { catalogRouter } from "./modules/catalog.js";
import { cardsRouter } from "./modules/cards.js";
import { ordersRouter } from "./modules/orders.js";

const app = express();

// En producción el frontend se sirve desde el mismo dominio que la API
// (Nginx manda / a los estáticos y /api acá), así que no hay cross-origin.
// CORS queda abierto sólo para el dev server de Vite, que sí está en otro
// puerto.
app.use(cors({ origin: config.publicUrl === "" ? true : [config.publicUrl, "http://localhost:3200"] }));
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/catalog", catalogRouter);          // público: se puede mirar sin cuenta
app.use("/api/cards", requireAuth, cardsRouter);
app.use("/api/orders", requireAuth, ordersRouter);

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
