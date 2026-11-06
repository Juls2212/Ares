/**
 * Local cancellation only; it never uploads audio or submits an instruction.
 * Escape and real page teardown cancel. Minimizing or hiding the window deliberately does not,
 * so a session started by the orb or the global shortcut survives background operation.
 */
export const bindRecordingCancellation = (documentTarget: EventTarget, windowTarget: EventTarget, cancel: () => void) => {
  const onKey = (event: Event) => { if ((event as KeyboardEvent).key === "Escape") cancel(); };
  documentTarget.addEventListener("keydown", onKey);
  windowTarget.addEventListener("pagehide", cancel);
  return () => {
    documentTarget.removeEventListener("keydown", onKey);
    windowTarget.removeEventListener("pagehide", cancel);
  };
};
