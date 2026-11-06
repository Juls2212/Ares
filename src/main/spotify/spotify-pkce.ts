import { createHash, randomBytes } from "node:crypto";

type RandomBytes = (size: number) => Buffer;

export type PkcePair = { verifier: string; challenge: string };

/** RFC 7636 S256 challenge for a verifier. */
export const toCodeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** A 86-character base64url verifier from 64 random bytes, and its S256 challenge. */
export const generatePkcePair = (random: RandomBytes = randomBytes): PkcePair => {
  const verifier = random(64).toString("base64url");
  return { verifier, challenge: toCodeChallenge(verifier) };
};

/** An unguessable value that ties the callback to this connection attempt. */
export const generateAuthorizationState = (random: RandomBytes = randomBytes): string =>
  random(24).toString("base64url");
