import { createHash, randomBytes, pbkdf2 } from "node:crypto";

function parseHeaderFeilds(str: string): Record<string, string> {
  const res = {};
  const parts = str.split(",");

  let part: string;
  while ((part = parts.shift()) != null) {
    const name = part.split("=", 1)[0];
    if (name.length === part.length) {
      if (!part.trim()) continue;
      throw new Error("Unable to parse auth header");
    }

    let value = part.slice(name.length + 1);
    if (!/^\s*"/.test(value)) {
      value = value.trim();
    } else {
      while (!/[^\\]"\s*$/.test(value)) {
        const p = parts.shift();
        if (p == null) throw new Error("Unable to parse auth header");
        value += "," + p;
      }

      try {
        value = JSON.parse(value);
      } catch (error) {
        throw new Error("Unable to parse auth header");
      }
    }
    res[name.trim()] = value;
  }
  return res;
}

export function parseAuthorizationHeader(authHeader: string): {
  method: string;
} {
  authHeader = authHeader.trim();
  const method = authHeader.split(" ", 1)[0];
  const res = { method: method };

  if (method === "Basic") {
    // Inspired by https://github.com/jshttp/basic-auth
    const USER_PASS_REGEX = /^([^:]*):(.*)$/;
    const creds = USER_PASS_REGEX.exec(
      Buffer.from(authHeader.slice(method.length + 1), "base64").toString(),
    );

    if (!creds) throw new Error("Unable to parse auth header");
    res["username"] = creds[1];
    res["password"] = creds[2];
  } else if (method === "Digest") {
    Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));
  }

  return res;
}

export function parseWwwAuthenticateHeader(
  authHeader: string,
): Record<string, string> {
  authHeader = authHeader.trim();
  const method = authHeader.split(" ", 1)[0];
  const res = { method: method };
  Object.assign(res, parseHeaderFeilds(authHeader.slice(method.length + 1)));
  return res;
}

export function basic(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

export type DigestAlgorithm = "MD5" | "SHA-256" | "MD5-sess" | "SHA-256-sess";

const DIGEST_HASHES: Record<string, string> = {
  MD5: "md5",
  "SHA-256": "sha256",
  "MD5-sess": "md5",
  "SHA-256-sess": "sha256",
};

export function isDigestAlgorithm(value: unknown): value is DigestAlgorithm {
  return typeof value === "string" && Object.hasOwn(DIGEST_HASHES, value);
}

export function digest(
  username: string | Buffer,
  realm: string | Buffer,
  password: string | Buffer,
  nonce: string | Buffer,
  httpMethod: string | Buffer,
  uri: string | Buffer,
  qop?: string | Buffer,
  body?: string | Buffer,
  cnonce?: string | Buffer,
  nc?: string | Buffer,
  algorithm?: DigestAlgorithm,
): string {
  // Absent algorithm defaults to MD5 for legacy protocol compatibility
  // (see docs/operations/legacy-protocol-crypto.md); an explicit label is
  // honored with the hash it names — never silently computed as MD5.
  const label = algorithm ?? "MD5";
  const hashName = DIGEST_HASHES[label];
  if (!hashName)
    throw new Error(`Unsupported digest algorithm: ${String(algorithm)}`);

  let ha1d: string;
  if (label.endsWith("-sess")) {
    // RFC 7616 section 3.4.2 session variant.
    const ha1 = createHash(hashName)
      .update(username)
      .update(":")
      .update(realm)
      .update(":")
      .update(password)
      .digest("hex");
    ha1d = createHash(hashName)
      .update(ha1)
      .update(":")
      .update(nonce)
      .update(":")
      .update(cnonce ?? "")
      .digest("hex");
  } else {
    ha1d = createHash(hashName)
      .update(username)
      .update(":")
      .update(realm)
      .update(":")
      .update(password)
      .digest("hex");
  }

  const ha2 = createHash(hashName);
  ha2.update(httpMethod).update(":").update(uri);

  if (qop === "auth-int") {
    const bodyHash = createHash(hashName)
      .update(body || "")
      .digest("hex");
    ha2.update(":").update(bodyHash);
  }

  const ha2d = ha2.digest("hex");

  const hash = createHash(hashName);
  hash.update(ha1d).update(":").update(nonce);
  if (qop) {
    hash
      .update(":")
      .update(nc)
      .update(":")
      .update(cnonce)
      .update(":")
      .update(qop);
  }
  hash.update(":").update(ha2d);

  return hash.digest("hex");
}

export function solveDigest(
  username: string | Buffer,
  password: string | Buffer,
  uri: string | Buffer,
  httpMethod: string | Buffer,
  body: string | Buffer,
  authHeader: Record<string, string>,
): string {
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";

  let qop;
  if (authHeader.qop) {
    if (authHeader.qop.indexOf(",") !== -1) qop = "auth";
    // Either auth or auth-int, prefer auth
    else qop = authHeader.qop;
  }

  // Absent algorithm keeps the MD5 legacy default; an advertised label is
  // used with its own hash and unknown labels are rejected outright
  // instead of being quietly computed as MD5.
  const algorithm = (authHeader.algorithm as DigestAlgorithm) ?? "MD5";
  if (!isDigestAlgorithm(algorithm))
    throw new Error(`Unsupported digest algorithm: ${authHeader.algorithm}`);

  const hash = digest(
    username,
    authHeader.realm,
    password,
    authHeader.nonce,
    httpMethod,
    uri,
    qop,
    body,
    cnonce,
    nc,
    algorithm,
  );

  let authString = `Digest username="${username}"`;
  authString += `,realm="${authHeader.realm}"`;
  authString += `,nonce="${authHeader.nonce}"`;
  authString += `,uri="${uri}"`;
  authString += `,algorithm=${algorithm}`;
  if (qop) authString += `,qop=${qop},nc=${nc},cnonce="${cnonce}"`;
  authString += `,response="${hash}"`;
  if (authHeader.opaque) authString += `,opaque="${authHeader.opaque}"`;

  return authString;
}

export function generateSalt(length: number): Promise<string> {
  return new Promise((resolve, reject) => {
    randomBytes(length, (err, rand) => {
      if (err) return void reject(err);
      resolve(rand.toString("hex"));
    });
  });
}

export function hashPassword(pass: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    pbkdf2(pass, salt, 10000, 128, "sha512", (err, hash) => {
      if (err) return void reject(err);
      resolve(hash.toString("hex"));
    });
  });
}
