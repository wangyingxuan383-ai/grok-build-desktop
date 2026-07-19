import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Attachment, AttachmentPrivacyFinding } from "../../shared/types";

const PRIVATE_KEY = /(?:^|[._-])(?:id_rsa|id_ed25519|private[-_]?key)(?:$|[._-])|\.(?:pem|key|p12|pfx|kdbx)$/i;
const CREDENTIAL = /(?:^|[._-])(?:credential|credentials|secret|secrets|password|passwd|token|auth)(?:$|[._-])|auth\.json$/i;
const ENVIRONMENT = /^\.env(?:\..+)?$/i;

export function inspectAttachmentPrivacy(cwd: string, attachments: Attachment[]): AttachmentPrivacyFinding[] {
  const root = cwd ? resolve(cwd) : "";
  const output: AttachmentPrivacyFinding[] = [];
  for (const attachment of attachments) {
    if (!attachment.path) continue;
    const name = attachment.name || attachment.path.split(/[\\/]/).at(-1) || "文件";
    const path = resolve(attachment.path);
    if (root && isAbsolute(path) && isOutside(root, path)) output.push({ attachmentId: attachment.id, name, kind: "outside-workspace", severity: "warning", message: `${name} 位于当前工作区之外` });
    if (ENVIRONMENT.test(name)) output.push({ attachmentId: attachment.id, name, kind: "environment", severity: "high", message: `${name} 可能包含环境变量或密钥` });
    else if (PRIVATE_KEY.test(name)) output.push({ attachmentId: attachment.id, name, kind: "private-key", severity: "high", message: `${name} 看起来是私钥或证书文件` });
    else if (CREDENTIAL.test(name)) output.push({ attachmentId: attachment.id, name, kind: "credential", severity: "high", message: `${name} 看起来可能包含凭据` });
  }
  return output;
}

function isOutside(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
}
