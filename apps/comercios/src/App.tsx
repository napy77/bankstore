import React, { useState } from "react";
import {
  useStaffSession, LoginScreen, Shell, Loading, type StaffUser,
} from "@bankstore/shared";
import { Productos } from "./Productos.js";
import { Ordenes } from "./Ordenes.js";
import { ApiKeys } from "./ApiKeys.js";
import { Resumen } from "./Resumen.js";

/**
 * Panel de comercios.
 *
 * Deja entrar a cualquier usuario que pertenezca a un comercio. Un
 * administrador de plataforma NO entra acá: no tiene comercio propio, así que
 * ninguna de las pantallas tendría sentido.
 */
function permitir(user: StaffUser): string | null {
  if (!user.merchantId) {
    return "Esta cuenta es de la plataforma, no de un comercio. Entrá por el panel de administración.";
  }
  return null;
}

const SECCIONES = [
  { id: "resumen", label: "Resumen" },
  { id: "productos", label: "Productos" },
  { id: "ordenes", label: "Órdenes" },
  { id: "apikeys", label: "Integración" },
];

export default function App() {
  const { user, setUser, checking, api, logout } = useStaffSession(permitir);
  const [section, setSection] = useState("resumen");

  if (checking) return <Loading what="Verificando sesión" />;

  if (!user) {
    return (
      <LoginScreen
        title="Bankstore"
        subtitle="Panel de comercios"
        api={api}
        allow={permitir}
        onLogin={setUser}
      />
    );
  }

  return (
    <Shell
      title="Bankstore"
      subtitle={user.merchantName ?? "Panel de comercios"}
      user={user}
      sections={SECCIONES}
      current={section}
      onNavigate={setSection}
      onLogout={logout}
    >
      {section === "resumen" && <Resumen api={api} />}
      {section === "productos" && <Productos api={api} />}
      {section === "ordenes" && <Ordenes api={api} />}
      {section === "apikeys" && <ApiKeys api={api} />}
    </Shell>
  );
}
