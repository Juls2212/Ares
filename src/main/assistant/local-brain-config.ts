/**
 * Local-first routing. When true, a small set of exact-grammar commands (open a registered application, search files, time and
 * date, agenda of a near day, computer information, help and small talk) is answered by the offline local brain without calling
 * the cloud provider, but only where the cloud flow would give the same capability. Set it to false to send every request to
 * the cloud provider again, exactly as before local mode existed; the local brain then only answers when the provider is
 * missing, unavailable or too slow.
 */
export const LOCAL_FIRST_ENABLED = true;
