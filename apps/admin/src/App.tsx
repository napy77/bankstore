import React, { useState } from "react";
import {
  useStaffSession, LoginScreen, Shell, Loading, type StaffUser,
} from "@bankstore/shared";
import { Comercios } from "./Comercios.js";
import { Acuerdos } from "./Acuerdos.js";
import { Liquidaciones } from "./Liquidaciones.js";
import { Usuarios } from "./Usuarios.js";

/**
 * Panel de administración de la plataforma.
 *
 * Sólo entra `platform_admin`. El backend igual rechaza a cualquier otro en
 * /api/admin, y Nginx sólo publica este subdominio en la intranet: son tres
 * capas para lo mismo, a propósito. Con esta cuenta se da de alta cualquier
 * comercio y se cambia cualquier condición comercial.
 */
function permitir(user: StaffUser): string | null {
  if (user.role !== "platform_admin") {
    return "Esta cuenta no es de la plataforma. Si sos de un comercio, entrá por el panel de comercios.";
  }
  return null;
}

const SECCIONES = [
  { id: "comercios", label: "Comercios" },
  { id: "acuerdos", label: "Acuerdos bancarios" },
  { id: "liquidaciones", label: "Liquidaciones" },
  { id: "usuarios", label: "Usuarios" },
];

export default function App() {
  const { user, setUser, checking, api, logout } = useStaffSession(permitir);
  const [section, setSection] = useState("comercios");

  if (checking) return <Loading what="Verificando sesión" />;

  if (!user) {
    return (
      <LoginScreen
        title="Bankstore"
        subtitle="Administración de la plataforma"
        api={api}
        allow={permitir}
        onLogin={setUser}
      />
    );
  }

  return (
    <Shell
      title="Bankstore"
      subtitle="Administración"
      user={user}
      sections={SECCIONES}
      current={section}
      onNavigate={setSection}
      onLogout={logout}
    >
      {section === "comercios" && <Comercios api={api} />}
      {section === "acuerdos" && <Acuerdos api={api} />}
      {section === "liquidaciones" && <Liquidaciones api={api} />}
      {section === "usuarios" && <Usuarios api={api} />}
    </Shell>
  );
}
