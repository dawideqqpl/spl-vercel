import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { fetch } from 'undici';
import { Buffer } from 'buffer';



export default async function handler(req, res) {
  res.status(200).json({ message: "Transakcja wysyłana..." });

  main()
    .then(() => console.log("✅ Transakcja zakończona"))
    .catch((e) => console.error("❌ Błąd transakcji:", e));
}

async function main() {
const RPC_URL = 'https://rpc.ankr.com/solana';
  const secretKeyArray = [125,77,219,190,223,137,24,201,29,211,222,67,78,33,247,211,9,254,206,170,175,105,128,82,98,132,12,79,72,69,40,8,247,11,34,167,3,168,175,36,117,50,46,86,156,24,100,11,254,219,20,113,208,145,82,16,58,69,5,204,188,217,184,254];
  const recipient = 'CWvmqg5k2RpFbeunZuJ7ZqVbr69wQA2AFq3aQ8xM2BGM';
  const mint = 'ULwSJmmpxmnRfpu6BjnK6rprKXqD5jXUmPpS1FxHXFy';
  const amount = 1_000_000;

  console.log("▶️ Startuję main()");

  const secretKey = Uint8Array.from(secretKeyArray);
  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
  const senderPubkey = keypair.publicKey;
  const senderBase58 = bs58.encode(senderPubkey);

  console.log("🔑 Nadawca:", senderBase58);
console.log("📡 Pobieram ATA nadawcy...");
const senderATA = '2KMLi1hd6Mc9GAm2sPc5R3r1NCLv3diMmSDeHGh4nRBW';
const recipientATA = '3dcEZjH8orBGqrTfTZt1cPzvUdobobBXW7ZKD93J1iKEs';
 // const senderATA = await getATA(senderBase58, mint, RPC_URL);
//  const recipientATA = await getATA(recipient, mint, RPC_URL);
  const recentBlockhash = await getRecentBlockhash(RPC_URL);

  console.log("📦 ATA nadawcy:", senderATA);
  console.log("📥 ATA odbiorcy:", recipientATA);
  console.log("🧱 Blockhash:", recentBlockhash);

  const ix = {
    programId: bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    keys: [
      { pubkey: bs58.decode(senderATA), isSigner: false, isWritable: true },
      { pubkey: bs58.decode(recipientATA), isSigner: false, isWritable: true },
      { pubkey: senderPubkey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([3]), writeUInt64LE(amount)])
  };

  const msg = buildMessage({
    payer: senderPubkey,
    recentBlockhash: bs58.decode(recentBlockhash),
    instructions: [ix]
  });

  const sig = nacl.sign.detached(msg, secretKey);
  const tx = Buffer.concat([Buffer.from([1]), sig, msg]);
  const txBase64 = tx.toString('base64');

  const resTx = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [txBase64, { encoding: 'base64' }]
    })
  });

  const json = await resTx.json();
  console.log("📤 Odpowiedź RPC:", json);
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

function equals(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

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
  const compiledInstructions = instructions.map(ix => ({
    programIdIndex: accountKeys.findIndex(k => equals(k, ix.programId)),
    accountIndices: ix.keys.map(k => accountKeys.findIndex(a => equals(a, k.pubkey))),
    data: ix.data
  }));

  const instructionBuffers = Buffer.concat([
    encodeLength(compiledInstructions.length),
    ...compiledInstructions.map(serializeInstruction)
  ]);

  return Buffer.concat([
    header,
    encodeLength(accountKeys.length),
    keyBuffers,
    recentBlockhash,
    instructionBuffers
  ]);
}

async function getRecentBlockhash(RPC_URL) {
  console.log("🌐 Pobieram blockhash...");

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error("⏰ Timeout – przerywam fetch blockhash");
    controller.abort();
  }, 8000);

  try {
    console.log("🧪 fetch START");
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash'
      }),
      signal: controller.signal
    });

    console.log("📩 Odpowiedź odebrana – parsuję JSON...");
    clearTimeout(timeout);
    const json = await res.json();
    console.log("📦 JSON z blockhash:", JSON.stringify(json));

    if (!json?.result?.value?.blockhash) {
      throw new Error("❌ Brak blockhash w odpowiedzi RPC");
    }

    return json.result.value.blockhash;

  } catch (err) {
    console.error("🔥 Błąd pobierania blockhash:", err);
    throw err;
  }
}



async function getATA(wallet, mint, RPC_URL) {
 console.log("📡 RPC getTokenAccountsByOwner dla:", wallet);

  const res = await fetch(RPC_URL, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [wallet, { mint }, { encoding: "jsonParsed" }]
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  const json = await res.json();
  if (!json.result.value[0]) throw new Error(`ATA dla ${wallet} i mint ${mint} nie istnieje`);
  return json.result.value[0].pubkey;
}
