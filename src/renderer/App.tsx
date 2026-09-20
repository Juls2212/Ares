import { useEffect, useState } from "react";
import type { SystemCapabilities, SystemStatusData } from "../shared/contracts";

type ViewState =
  | { kind: "LOADING" }
  | {
      kind: "SUCCESS";
      status: SystemStatusData;
      capabilities: SystemCapabilities;
    }
  | { kind: "ERROR"; userMessage: string };

const capabilityLabels: Record<keyof SystemCapabilities, string> = {
  database: "Base de datos",
  dashboard: "Inicio",
  planner: "Planificador",
  files: "Archivos",
  applications: "Aplicaciones",
  assistant: "Asistente",
  voice: "Voz",
  notifications: "Notificaciones"
};

export const App = () => {
  const [viewState, setViewState] = useState<ViewState>({ kind: "LOADING" });

  useEffect(() => {
    const loadTechnicalStatus = async (): Promise<void> => {
      const [statusResult, capabilitiesResult] = await Promise.all([
        window.ares.system.getStatus(),
        window.ares.system.getCapabilities()
      ]);

      if (!statusResult.ok) {
        setViewState({ kind: "ERROR", userMessage: statusResult.error.userMessage });
        return;
      }

      if (!capabilitiesResult.ok) {
        setViewState({
          kind: "ERROR",
          userMessage: capabilitiesResult.error.userMessage
        });
        return;
      }

      setViewState({
        kind: "SUCCESS",
        status: statusResult.data,
        capabilities: capabilitiesResult.data
      });
    };

    void loadTechnicalStatus().catch(() => {
      setViewState({
        kind: "ERROR",
        userMessage: "No se pudo consultar el estado técnico de Ares."
      });
    });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-white p-8 text-slate-900">
      <section className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold">Ares</h1>
        <p className="text-base">Base técnica en funcionamiento</p>
        {viewState.kind === "LOADING" && (
          <p className="text-sm text-slate-600">Consultando estado técnico...</p>
        )}
        {viewState.kind === "ERROR" && (
          <p className="text-sm text-slate-600">{viewState.userMessage}</p>
        )}
        {viewState.kind === "SUCCESS" && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>La comunicación segura está en funcionamiento.</p>
            <p>Versión {viewState.status.applicationVersion}</p>
            <ul className="list-none p-0">
              {(Object.keys(viewState.capabilities) as Array<keyof SystemCapabilities>).map(
                (capability) => (
                  <li key={capability}>
                    {capabilityLabels[capability]}: {viewState.capabilities[capability] ? "disponible" : "no disponible todavía"}
                  </li>
                )
              )}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
};
