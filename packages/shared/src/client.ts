/**
 * Cliente HTTP compartido por las tres apps.
 *
 * En producción cada subdominio sirve su propio front y proxea /api al mismo
 * backend, así que la base es relativa y no hay cross-origin. En desarrollo
 * cada app corre en su puerto de Vite y la API en otro, por eso VITE_API_URL.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Detalle de zod cuando el backend rechaza el cuerpo. */
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Dónde se guarda el token. Una clave por ámbito para que abrir la tienda y
 * el panel en el mismo navegador no se pisen. En producción son orígenes
 * distintos y ya estarían separados, pero en desarrollo comparten localhost.
 */
export type Realm = "customer" | "staff";

const STORAGE_KEY: Record<Realm, string> = {
  customer: "bankstore.token.customer",
  staff: "bankstore.token.staff",
};

export function getToken(realm: Realm): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY[realm]);
  } catch {
    // Safari en modo privado tira al tocar localStorage
    return null;
  }
}

export function setToken(realm: Realm, token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(STORAGE_KEY[realm]);
    else localStorage.setItem(STORAGE_KEY[realm], token);
  } catch {
    /* sin persistencia: la sesión dura lo que la pestaña */
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Si se omite, la request va sin credenciales (endpoints públicos). */
  realm?: Realm;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Se llama cuando el backend responde 401: sirve para volver al login. */
  onUnauthorized?: () => void;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl =
    options.baseUrl ??
    (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ??
    "";

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    if (opts.realm) {
      const token = getToken(opts.realm);
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });

    if (res.status === 401 && opts.realm) {
      // El token venció o lo revocaron: se limpia para que la app no quede
      // en un bucle de requests que van a fallar igual.
      setToken(opts.realm, null);
      options.onUnauthorized?.();
    }

    if (res.status === 204) return undefined as T;

    // Un 502 de Nginx o un backend caído devuelven HTML, no JSON. Sin este
    // guard el error que ve el usuario es "Unexpected token < in JSON".
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      if (!res.ok) {
        throw new ApiError(res.status, `El servidor respondió ${res.status}`);
      }
      return undefined as T;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.details);
    }
    return data as T;
  }

  return {
    request,
    get: <T>(path: string, realm?: Realm) => request<T>(path, { realm }),
    post: <T>(path: string, body?: unknown, realm?: Realm) =>
      request<T>(path, { method: "POST", body, realm }),
    patch: <T>(path: string, body?: unknown, realm?: Realm) =>
      request<T>(path, { method: "PATCH", body, realm }),
    put: <T>(path: string, body?: unknown, realm?: Realm) =>
      request<T>(path, { method: "PUT", body, realm }),
    del: <T>(path: string, realm?: Realm) => request<T>(path, { method: "DELETE", realm }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
