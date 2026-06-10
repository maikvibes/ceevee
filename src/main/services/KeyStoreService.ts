import crypto from 'crypto'

export class KeyStoreService {
  private static masterKey: Buffer | null = null

  /**
   * Derives a 32-byte master key from the given password and caches it in memory.
   */
  static unlock(password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use scrypt to derive a strong 32-byte key. 
      // In a real app, a fixed salt should be loaded from DB or filesystem.
      const salt = 'ceevee-static-salt'
      crypto.scrypt(password, salt, 32, (err, derivedKey) => {
        if (err) return reject(err)
        this.masterKey = derivedKey
        resolve()
      })
    })
  }

  static isLocked(): boolean {
    return this.masterKey === null
  }

  static lock(): void {
    this.masterKey = null
  }

  /**
   * Encrypts a plaintext string using AES-256-GCM.
   */
  static encrypt(plaintext: string): { encryptedKey: string, iv: string, authTag: string } {
    if (!this.masterKey) throw new Error('Keystore is locked. Master password not provided.')

    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv)
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    
    const authTag = cipher.getAuthTag().toString('hex')

    return {
      encryptedKey: encrypted,
      iv: iv.toString('hex'),
      authTag
    }
  }

  /**
   * Decrypts an encrypted string using AES-256-GCM.
   */
  static decrypt(encryptedKey: string, ivHex: string, authTagHex: string): string {
    if (!this.masterKey) throw new Error('Keystore is locked. Master password not provided.')

    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv)
    decipher.setAuthTag(authTag)
    
    let decrypted = decipher.update(encryptedKey, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  }
}
