import nacl from 'tweetnacl';
import bs58 from 'bs58';
//import fetch from 'node-fetch';
//import { Buffer } from 'buffer';
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const Buffer = (await import('buffer')).Buffer;
// ========== KONFIGURACJA ==========
const RPC_URL = 'https://rpc.magicblock.app/mainnet/';
const secretKeyArray = [125,77,219,190,223,137,24,201,29,211,222,67,78,33,247,211,9,254,206,170,175,105,128,82,98,132,12,79,72,69,40,8,247,11,34,167,3,168,175,36,117,50,46,86,156,24,100,11,254,219,20,113,208,145,82,16,58,69,5,204,188,217,184,254];
const recipient = 'CWvmqg5k2RpFbeunZuJ7ZqVbr69wQA2AFq3aQ8xM2BGM';
const mint = 'ULwSJmmpxmnRfpu6BjnK6rprKXqD5jXUmPpS1FxHXFy';
const amount = 1_000_000;

// ========== FUNKCJE POMOCNICZE ==========

function equals(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

function writeUInt64LE(value) {
  const buffer = Buffer.alloc(8);
  let big = BigInt(value);
  for (let i = 0; i < 8; i++) {
    buffer[i] = Number(big & 0xffn);
    big >>= 8n;
  }
  return buffer;
}

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  else if (len < 0x4000) return Buffer.from([(len & 0x7f) | 0x80, len >> 7]);
  else throw new Error('Length too long');
}

function serializeInstruction(ix) {
  const out = [];
  out.push(Buffer.from([ix.programIdIndex]));
  out.push(encodeLength(ix.accountIndices.length));
  out.push(Buffer.from(ix.accountIndices));
  out.push(encodeLength(ix.data.length));
  out.push(ix.data);
  return Buffer.concat(out);
}

// ========== GŁÓWNA FUNKCJA ==========

async function main() {
  const secretKey = Uint8Array.from(secretKeyArray);
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  const senderPubkey = keypair.publicKey;
  const senderBase58 = bs58.encode(senderPubkey);
  console.log("▶️ Nadawca:", senderBase58);

  const senderATA = await getATA(senderBase58, mint);
  const recipientATA = await getATA(recipient, mint);
  console.log("📦 ATA nadawcy:", senderATA);
  console.log("📥 ATA odbiorcy:", recipientATA);

  const recentBlockhash = await getRecentBlockhash();
  console.log("🧱 Blockhash:", recentBlockhash);

  // === Transfer SPL Token ===
  const ix = {
    programId: bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    keys: [
      { pubkey: bs58.decode(senderATA), isSigner: false, isWritable: true },
      { pubkey: bs58.decode(recipientATA), isSigner: false, isWritable: true },
      { pubkey: senderPubkey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([3]), writeUInt64LE(amount)]), // transfer
  };

  const msg = buildMessage({
    payer: senderPubkey,
    recentBlockhash: bs58.decode(recentBlockhash),
    instructions: [ix],
  });

  const sig = nacl.sign.detached(msg, secretKey);
  const tx = Buffer.concat([Buffer.from([1]), sig, msg]);
  const txBase64 = tx.toString('base64');

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [txBase64, { encoding: 'base64' }],
    })
  });

  const json = await res.json();
  if (json.error) console.error("❌ Błąd:", json.error);
  else console.log("✅ Transakcja wysłana:", json.result);
}

// ========== SERIALIZACJA TRANSAKCJI ==========

function buildMessage({ payer, recentBlockhash, instructions }) {
  const accounts = [{
    key: payer,
    isSigner: true,
    isWritable: true
  }];

  for (const ix of instructions) {
    for (const key of ix.keys) {
      if (!accounts.find(a => equals(a.key, key.pubkey))) {
        accounts.push({
          key: key.pubkey,
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        });
      }
    }

    if (!accounts.find(a => equals(a.key, ix.programId))) {
      accounts.push({
        key: ix.programId,
        isSigner: false,
        isWritable: false,
      });
    }
  }

  const accountKeys = accounts.map(a => a.key);
  const header = Buffer.from([
    accounts.filter(a => a.isSigner).length,
    0,
    accounts.filter(a => !a.isSigner && !a.isWritable).length
  ]);

  const keyBuffers = Buffer.concat(accountKeys.map(k => Buffer.from(k)));
  const blockhashBuf = Buffer.from(recentBlockhash);

  const compiledInstructions = instructions.map(ix => ({
    programIdIndex: accountKeys.findIndex(k => equals(k, ix.programId)),
    accountIndices: ix.keys.map(k =>
      accountKeys.findIndex(a => equals(a, k.pubkey))
    ),
    data: ix.data,
  }));

  const instructionBuffers = Buffer.concat([
    encodeLength(compiledInstructions.length),
    ...compiledInstructions.map(serializeInstruction)
  ]);

  return Buffer.concat([
    header,
    encodeLength(accountKeys.length),
    keyBuffers,
    blockhashBuf,
    instructionBuffers
  ]);
}

// ========== RPC HELPERS ==========

async function getRecentBlockhash() {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestBlockhash',
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  const json = await res.json();
  return json.result.value.blockhash;
}

async function getATA(wallet, mint) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        wallet,
        { mint },
        { encoding: "jsonParsed" }
      ]
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  const json = await res.json();
  if (!json.result.value[0]) throw new Error(`ATA dla ${wallet} i mint ${mint} nie istnieje`);
  return json.result.value[0].pubkey;
}

//main().catch(console.error);
export default async function handler(req, res) {
  // cały Twój kod tu w środku
}
