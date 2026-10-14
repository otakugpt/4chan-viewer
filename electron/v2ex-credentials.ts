import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface CryptoStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
const validToken = (value: unknown): value is string => typeof value === "string" && /^[!-~]{16,512}$/.test(value);

// Only this main-process vault handles plaintext credentials. Status never returns them.
export function createV2exVault(file: string, crypto: CryptoStorage) {
  let token = "", persistent = false, revision = 0, error: string | undefined;
  const canPersist = () => {
    try { return crypto.isEncryptionAvailable() && crypto.getSelectedStorageBackend?.() !== "basic_text"; }
    catch { return false; }
  };
  try {
    if (fs.existsSync(file)) {
      if (!canPersist() || fs.statSync(file).size > 16_384) throw new Error();
      const value = crypto.decryptString(fs.readFileSync(file));
      if (!validToken(value)) throw new Error();
      token = value; persistent = true;
    }
  } catch { error = "保存したトークンを復号できません。接続設定で再設定または削除してください。"; }
  const status = (): V2exCredentialStatus => ({ configured: !!token, persistent, canPersist: canPersist(), ...(error ? { error } : {}) });
  function settings(input: unknown): V2exCredentialStatus {
    try {
      if (!input || typeof input !== "object") throw new Error();
      const request = input as V2exSettingsRequest;
      if (request.kind === "status") return status();
      if (request.kind !== "clear" && request.kind !== "set") throw new Error();
      if (request.kind === "set") {
        if (!validToken(request.token) || typeof request.persist !== "boolean") return { ...status(), error: "トークンの形式を確認してください（空白・改行は使用できません）。" };
        if (request.persist) {
          if (!canPersist()) return { ...status(), error: "安全な暗号化保存を利用できません。「このPCに保存」をオフにしてください。" };
          const encrypted = crypto.encryptString(request.token);
          if (encrypted.length > 16_384) throw new Error();
          const temporary = file + "." + randomUUID() + ".tmp";
          fs.mkdirSync(path.dirname(file), { recursive: true });
          try { fs.writeFileSync(temporary, encrypted, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); }
          finally { try { fs.unlinkSync(temporary); } catch { /* Already renamed, or creation failed. */ } }
        } else {
          try { fs.unlinkSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        }
        token = request.token; persistent = request.persist;
      } else {
        try { fs.unlinkSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        token = ""; persistent = false;
      }
      revision++; error = undefined;
      return status();
    } catch { return { ...status(), error: "接続設定を変更できませんでした。保存先のアクセス権を確認してください。" }; }
  }
  return { settings, snapshot: () => ({ token, revision }) };
}
