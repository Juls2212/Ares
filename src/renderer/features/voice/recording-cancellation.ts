/** Local cancellation only; it never uploads audio or submits an instruction. */
export const bindRecordingCancellation = (documentTarget: EventTarget, windowTarget: EventTarget, isHidden: () => boolean, cancel: () => void) => {
  const onKey = (event: Event) => { if ((event as KeyboardEvent).key === "Escape") cancel(); };
  const onVisibility = () => { if (isHidden()) cancel(); };
  documentTarget.addEventListener("keydown", onKey);
  documentTarget.addEventListener("visibilitychange", onVisibility);
  windowTarget.addEventListener("pagehide", cancel);
  return () => {
    documentTarget.removeEventListener("keydown", onKey);
    documentTarget.removeEventListener("visibilitychange", onVisibility);
    windowTarget.removeEventListener("pagehide", cancel);
  };
};
