// PIN kilidi: PIN düz metin saklanmaz; PBKDF2-SHA256 (150.000 tur) ile
// tuzlanmış özeti tutulur.

const ITERATIONS = 150_000

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomSalt(): string {
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return toHex(a.buffer)
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS },
    key,
    256,
  )
  return toHex(bits)
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  const h = await hashPin(pin, salt)
  // sabit süreli karşılaştırma
  if (h.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}
