import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

// Stored as `scrypt$<salt hex>$<key hex>` so the algorithm can change later.
export async function hashPassword(password: string): Promise<string> {
  let salt = randomBytes(16)
  let key = await scryptAsync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let [algorithm, saltHex, keyHex] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false

  let expected = Buffer.from(keyHex, 'hex')
  let actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}
