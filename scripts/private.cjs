#!/usr/bin/env node
/* Seal the presenter's personal details with the shared access code.
   The browser (access.js) derives the same AES-GCM key with PBKDF2-SHA256 and
   entering the code is the decryption: nothing in the published site or this
   repository holds the code or the plain text. Keep this file and access.js in step. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { webcrypto } = require('node:crypto');

const { subtle } = webcrypto;
const ITERATIONS = 300000;
const encode = text => new TextEncoder().encode(text);
const b64 = bytes => Buffer.from(bytes).toString('base64');
const unb64 = text => new Uint8Array(Buffer.from(text, 'base64'));
const normalise = code => code.trim().toUpperCase();

async function deriveKey(code, salt, iterations, usage) {
  const material = await subtle.importKey('raw', encode(normalise(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
async function encrypt(fields, code, iterations = ITERATIONS) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt, iterations, 'encrypt');
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encode(JSON.stringify(fields)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
}
async function decrypt(payload, code) {
  const key = await deriveKey(code, unb64(payload.salt), payload.iterations, 'decrypt');
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function askCode() {
  if (process.env.ACCESS_CODE) return Promise.resolve(process.env.ACCESS_CODE);
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => rl.question('Access code: ', answer => { rl.close(); resolve(answer); }));
}
async function main() {
  const [input = 'private/speaker.json', output = 'speaker.enc.json'] = process.argv.slice(2);
  const fields = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`${input} must hold a JSON object of text fields.`);
  const code = normalise(await askCode());
  if (!code) throw new Error('An access code is required.');
  const payload = await encrypt(fields, code);
  const check = await decrypt(payload, code);
  if (JSON.stringify(check) !== JSON.stringify(fields)) throw new Error('Round-trip check failed.');
  fs.writeFileSync(output, `${JSON.stringify(payload)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), output)} with fields: ${Object.keys(fields).join(', ')}.`);
  console.log('Rebuild and deploy. Anyone who has the old code must be given the new one.');
}

module.exports = { encrypt, decrypt, normalise, ITERATIONS };
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
