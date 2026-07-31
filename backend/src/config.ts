import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4020),
  // En el servidor se ata a 127.0.0.1: a la API se entra por Nginx, no directo.
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://bankstore:bankstore@localhost:5434/bankstore",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3200",

  /**
   * Parámetros financieros del emisor. Se leen del entorno porque las tasas
   * cambian seguido y no queremos un deploy para tocarlas.
   *
   * tnaDefault: Tasa Nominal Anual que se cobra cuando el cliente elige más
   *   cuotas de las que el banco banca sin interés.
   * ivaSobreIntereses: en Argentina el interés de financiación paga IVA, y el
   *   CFT tiene que informarlo (Com. "A" 5460 del BCRA). 21% salvo que el
   *   emisor tenga alícuota reducida.
   */
  finance: {
    tnaDefault: Number(process.env.TNA_DEFAULT ?? 0.42), // 42% anual
    ivaSobreIntereses: Number(process.env.IVA_INTERESES ?? 0.21),
  },
};
