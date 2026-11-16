type Crypto = typeof import('./crypto');

const SECRET = 'una-clave-de-prueba-de-32-caracteres-o-mas';
const OTHER_SECRET = 'otra-clave-de-prueba-de-32-caracteres-o-mas';

/**
 * The module as an API started with this APP_SECRET has it. The key is derived on first use and
 * kept for the life of the process, so each "start" is a fresh copy of the module, used once while
 * the variable holds that value.
 */
function startedWith(secret: string | undefined): Crypto {
  const saved = process.env.APP_SECRET;
  if (secret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = secret;
  try {
    let loaded: Crypto | undefined;
    jest.isolateModules(() => {
      loaded = jest.requireActual<Crypto>('./crypto');
    });
    if (secret !== undefined) loaded!.encryptSecret('');
    return loaded!;
  } finally {
    if (saved === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = saved;
  }
}

/** The three parts of a stored value: nonce, tag and ciphertext. */
const parts = (stored: string): Buffer[] => stored.split('.').map((part) => Buffer.from(part, 'base64'));
const joined = (buffers: Buffer[]): string => buffers.map((part) => part.toString('base64')).join('.');

/** The stored value with one bit of one of its parts flipped. */
function flipped(stored: string, part: number, byte = 0): string {
  const buffers = parts(stored);
  buffers[part] = Buffer.from(buffers[part]);
  buffers[part][byte] ^= 0x01;
  return joined(buffers);
}

// The API keys of the AI providers are stored with these two functions (AiService): whoever reads
// the database, or a backup of it, must not get the keys, nor be able to plant one.
describe('encryptSecret and decryptSecret', () => {
  const crypto = startedWith(SECRET);

  it('give back what was stored', () => {
    for (const plain of ['sk-prueba-0123456789abcdef', '', 'clave con ñ, tildes y 🔑', 'x'.repeat(10_000)]) {
      expect(crypto.decryptSecret(crypto.encryptSecret(plain))).toBe(plain);
    }
  });

  it('store a 12-byte nonce, a 16-byte tag and the ciphertext, never the key as it was typed', () => {
    const plain = 'sk-prueba-0123456789abcdef';
    const stored = crypto.encryptSecret(plain);
    const [iv, tag, data] = parts(stored);

    expect(stored.split('.')).toHaveLength(3);
    expect(iv).toHaveLength(12);
    expect(tag).toHaveLength(16);
    expect(data).toHaveLength(Buffer.byteLength(plain));
    expect(stored).not.toContain(plain);
    expect(data.toString('utf8')).not.toContain('0123456789');
  });

  // A nonce used twice with the same key would give away the keys stored with it.
  it('store the same key differently each time, with a nonce of its own', () => {
    const first = crypto.encryptSecret('sk-prueba');
    const second = crypto.encryptSecret('sk-prueba');

    expect(first).not.toBe(second);
    expect(parts(first)[0].equals(parts(second)[0])).toBe(false);
    expect(crypto.decryptSecret(first)).toBe('sk-prueba');
    expect(crypto.decryptSecret(second)).toBe('sk-prueba');
  });

  it('refuse a stored value changed anywhere: the ciphertext, the tag or the nonce', () => {
    const stored = crypto.encryptSecret('sk-prueba-0123456789abcdef');

    for (const [part, byte] of [
      [2, 0],
      [2, 20],
      [1, 0],
      [1, 15],
      [0, 0],
      [0, 11],
    ]) {
      expect(() => crypto.decryptSecret(flipped(stored, part, byte))).toThrow();
    }
    // The value as it was still reads: what failed above is the change alone.
    expect(crypto.decryptSecret(stored)).toBe('sk-prueba-0123456789abcdef');
  });

  // Unless told the length, Node takes a tag as short as 4 bytes and checks only those: a planted
  // value would need about 4 billion tries instead of none that could ever work.
  it('refuse a tag cut short, even the first bytes of the right one', () => {
    const stored = crypto.encryptSecret('sk-prueba');
    const [iv, tag, data] = parts(stored);

    for (const length of [4, 8, 12, 15]) {
      expect(() => crypto.decryptSecret(joined([iv, tag.subarray(0, length), data]))).toThrow(/tag length/i);
    }
  });

  it('refuse a value that is not nonce, tag and ciphertext', () => {
    for (const stored of ['', 'sk-prueba', 'a.b', crypto.encryptSecret('sk-prueba').split('.').slice(0, 2).join('.')]) {
      expect(() => crypto.decryptSecret(stored)).toThrow();
    }
  });

  // Derived from APP_SECRET alone: a restart with the same one reads the keys it stored before.
  it('read after a restart what was stored with the same APP_SECRET', () => {
    const stored = crypto.encryptSecret('sk-prueba');

    expect(startedWith(SECRET).decryptSecret(stored)).toBe('sk-prueba');
  });

  // The README says so: with another APP_SECRET the keys are entered again in Configuración > IA.
  it('refuse what was stored with another APP_SECRET', () => {
    const stored = crypto.encryptSecret('sk-prueba');
    const other = startedWith(OTHER_SECRET);

    expect(() => other.decryptSecret(stored)).toThrow();
    expect(() => crypto.decryptSecret(other.encryptSecret('sk-prueba'))).toThrow();
  });

  it('refuse to work without APP_SECRET, rather than with a key anyone could guess', () => {
    const stored = crypto.encryptSecret('sk-prueba');
    const without = startedWith(undefined);
    const saved = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    try {
      expect(() => without.encryptSecret('sk-prueba')).toThrow('APP_SECRET is not set');
      expect(() => without.decryptSecret(stored)).toThrow('APP_SECRET is not set');
    } finally {
      if (saved !== undefined) process.env.APP_SECRET = saved;
    }
  });
});
