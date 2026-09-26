/** Only a new completed Main response is eligible; toggling never replays an old result. */
export const shouldAutomaticallySpeak = (input: {
  enabled: boolean; blocked: boolean; hidden: boolean; responseId?: string; previousId?: string;
}): boolean => input.enabled && !input.blocked && !input.hidden && Boolean(input.responseId) && input.responseId !== input.previousId;
