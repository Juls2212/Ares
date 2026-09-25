import {
  REGISTERABLE_CATALOG_APPLICATIONS,
  type RegisterableCatalogApplication
} from "../../../shared/application-contracts";
import { VOICE_SHORTCUTS, type VoiceShortcut, type VoiceShortcutEffectiveStatus } from "../../../shared/settings-contracts";
import { catalogApplicationLabels, voiceShortcutStatusLabels } from "../../app/app-state";
import type { ThemePreference } from "./theme-preference";

type UtilityPanelProperties = {
  voiceShortcutEnabled: boolean;
  selectedVoiceShortcut: VoiceShortcut;
  voiceShortcutStatus?: VoiceShortcutEffectiveStatus;
  voicePreferencesMessage?: string;
  isUpdatingVoicePreferences: boolean;
  onVoiceShortcutEnabledChange: (enabled: boolean) => void;
  onVoiceShortcutChange: (shortcut: VoiceShortcut) => void;
  onSaveVoicePreferences: () => void;
  selectedCatalogApplication: RegisterableCatalogApplication;
  isRegisteringCatalogApplication: boolean;
  catalogRegistrationMessage?: string;
  onCatalogApplicationChange: (application: RegisterableCatalogApplication) => void;
  onRegisterCatalogApplication: () => void;
  customDisplayName: string;
  isRegisteringCustomApplication: boolean;
  customRegistrationMessage?: string;
  onCustomDisplayNameChange: (displayName: string) => void;
  onRegisterCustomApplication: () => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
};

export const UtilityPanel = ({
  voiceShortcutEnabled,
  selectedVoiceShortcut,
  voiceShortcutStatus,
  voicePreferencesMessage,
  isUpdatingVoicePreferences,
  onVoiceShortcutEnabledChange,
  onVoiceShortcutChange,
  onSaveVoicePreferences,
  selectedCatalogApplication,
  isRegisteringCatalogApplication,
  catalogRegistrationMessage,
  onCatalogApplicationChange,
  onRegisterCatalogApplication,
  customDisplayName,
  isRegisteringCustomApplication,
  customRegistrationMessage,
  onCustomDisplayNameChange,
  onRegisterCustomApplication,
  theme,
  onToggleTheme
}: UtilityPanelProperties) => <aside className="utility-panel" id="utility-panel">
  <section>
    <p className="eyebrow">Apariencia</p>
    <button aria-pressed={theme === "dark"} className="text-button" onClick={onToggleTheme} type="button">
      {theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
    </button>
  </section>
  <section>
    <p className="eyebrow">Configuración de voz</p>
    <label className="toggle-control" htmlFor="voice-shortcut-enabled">
      <input checked={voiceShortcutEnabled} disabled={isUpdatingVoicePreferences} id="voice-shortcut-enabled" onChange={(event) => onVoiceShortcutEnabledChange(event.target.checked)} type="checkbox" />
      Activar atajo global de voz
    </label>
    <label htmlFor="voice-shortcut">Atajo de voz</label>
    <select disabled={isUpdatingVoicePreferences} id="voice-shortcut" onChange={(event) => onVoiceShortcutChange(event.target.value as VoiceShortcut)} value={selectedVoiceShortcut}>
      {VOICE_SHORTCUTS.map((shortcut) => <option key={shortcut} value={shortcut}>{shortcut}</option>)}
    </select>
    <button className="text-button" disabled={isUpdatingVoicePreferences} onClick={onSaveVoicePreferences} type="button">{isUpdatingVoicePreferences ? "Guardando..." : "Guardar configuración"}</button>
    {voiceShortcutStatus && <p className="utility-status">{voiceShortcutStatusLabels[voiceShortcutStatus]}</p>}
    {voicePreferencesMessage && <p aria-live="polite" className="utility-status">{voicePreferencesMessage}</p>}
  </section>
  <section>
    <p className="eyebrow">Registro de aplicaciones</p>
    <label htmlFor="catalog-application">Aplicación aprobada</label>
    <select disabled={isRegisteringCatalogApplication} id="catalog-application" onChange={(event) => onCatalogApplicationChange(event.target.value as RegisterableCatalogApplication)} value={selectedCatalogApplication}>
      {REGISTERABLE_CATALOG_APPLICATIONS.map((application) => <option key={application} value={application}>{catalogApplicationLabels[application]}</option>)}
    </select>
    <button className="text-button" disabled={isRegisteringCatalogApplication} onClick={onRegisterCatalogApplication} type="button">{isRegisteringCatalogApplication ? "Registrando..." : "Registrar aplicación"}</button>
    {catalogRegistrationMessage && <p aria-live="polite" className="utility-status">{catalogRegistrationMessage}</p>}
    <label htmlFor="custom-application-name">Aplicación personalizada</label>
    <input disabled={isRegisteringCustomApplication} id="custom-application-name" onChange={(event) => onCustomDisplayNameChange(event.target.value)} placeholder="Nombre de la aplicación" type="text" value={customDisplayName} />
    <button className="text-button" disabled={isRegisteringCustomApplication} onClick={onRegisterCustomApplication} type="button">{isRegisteringCustomApplication ? "Registrando..." : "Registrar aplicación personalizada"}</button>
    {customRegistrationMessage && <p aria-live="polite" className="utility-status">{customRegistrationMessage}</p>}
  </section>
</aside>;
