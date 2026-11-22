import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Stockage des enregistrements côté serveur.
 * - S3 compatible (Scaleway, OVH…) si les variables S3_* sont définies : c'est la cible pour la préprod et la prod.
 * - Sinon, disque local : dossier .data en développement et pendant les tests automatiques,
 *   /tmp sur Vercel (stockage temporaire, effacé à tout moment : uniquement pour un premier essai).
 */
export interface ObjectInfo {
  key: string;
  size: number;
}

export interface Store {
  kind: "s3" | "disque" | "temporaire";
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<ObjectInfo[]>;
}

class DiskStore implements Store {
  constructor(
    private readonly root: string,
    readonly kind: "disque" | "temporaire",
  ) {}
  async put(key: string, body: Uint8Array) {
    const path = join(this.root, key);
    await mkdir(join(path, ".."), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.part`;
    await writeFile(tmp, body);
    await rename(tmp, path);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(join(this.root, key)));
    } catch {
      return null;
    }
  }
  async list(prefix: string) {
    const dir = join(this.root, prefix);
    try {
      const names = await readdir(dir);
      const out: ObjectInfo[] = [];
      for (const n of names.sort()) {
        if (n.endsWith(".part")) continue;
        const s = await stat(join(dir, n));
        if (s.isFile()) out.push({ key: `${prefix}${n}`, size: s.size });
      }
      return out;
    } catch {
      return [];
    }
  }
}

class S3Store implements Store {
  readonly kind = "s3" as const;
  private readonly s3: S3Client;
  constructor(private readonly bucket: string) {
    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "fr-par",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  async put(key: string, body: Uint8Array, contentType = "application/octet-stream") {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }
  async list(prefix: string) {
    const out: ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const r = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  if (process.env.S3_BUCKET) store = new S3Store(process.env.S3_BUCKET);
  else if (process.env.VERCEL) store = new DiskStore("/tmp/podstud", "temporaire");
  else
    store = new DiskStore(process.env.PODSTUD_DATA_DIR ?? join(process.cwd(), ".data"), "disque");
  return store;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
