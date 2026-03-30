import crypto from 'crypto';
import nacl from 'tweetnacl';

/**
 * Giga Auth System v2.0
 * Handles cryptographic challenges for P-Stream bip39-based login.
 */

// In-memory challenge store (Hugging Face Spaces are persistent enough for this)
const challenges = new Map();

/**
 * Creates a unique random challenge for a public key.
 * @param {string} publicKey - Base64 encoded Ed25519 public key.
 */
export async function createChallenge(publicKey) {
  const challenge = crypto.randomBytes(32).toString('hex');
  
  // Store challenge with 5-minute expiry
  challenges.set(publicKey, {
    challenge,
    expires: Date.now() + 1000 * 60 * 5
  });
  
  console.log(`[Auth] Created challenge for key ending in ...${publicKey.slice(-8)}`);
  return challenge;
}

/**
 * Verifies a challenge signature.
 * @param {string} publicKey - Base64 encoded Ed25519 public key.
 * @param {string} signature - Base64 encoded signature.
 * @param {string} challenge - The original challenge hex string.
 */
export async function verifyChallenge(publicKey, signature, challenge) {
  const stored = challenges.get(publicKey);
  
  if (!stored) throw new Error('Challenge not found or expired');
  if (stored.challenge !== challenge) throw new Error('Challenge mismatch');
  if (stored.expires < Date.now()) {
    challenges.delete(publicKey);
    throw new Error('Challenge expired');
  }

  try {
    const pubKeyUint8 = Buffer.from(publicKey, 'base64');
    const sigUint8 = Buffer.from(signature, 'base64');
    const challengeUint8 = Buffer.from(challenge);

    // Ed25519 Signature Verification
    const isValid = nacl.sign.detached.verify(
      challengeUint8,
      sigUint8,
      pubKeyUint8
    );

    if (isValid) {
      challenges.delete(publicKey);
      return true;
    }
  } catch (e) {
    console.error('[Auth] Verification logic error:', e.message);
  }

  throw new Error('Invalid signature');
}