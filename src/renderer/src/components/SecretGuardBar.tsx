import { memo, useMemo, useState } from "react";
import { ShieldAlert, X } from "lucide-react";

export interface SecretFinding {
  kind: "api-key" | "private-key" | "env-secret";
  label: string;
  count: number;
}

const MAX_SCAN_CHARS = 262_144;

const API_KEY_PATTERNS: readonly RegExp[] = [
  /\bxai-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{24,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{24,}\b/g,
  /\bnpm_[A-Za-z0-9]{24,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{33,}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/g,
  /\bhf_[A-Za-z0-9]{24,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9._~+/=-]{20,}\b/gi,
];

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]{16,16384}?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;

const DB_CREDENTIAL_URI =
  /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/[^:\s"'@]+:)([^@\s"']+)(@)/gi;

const ENV_SECRET_LINE =
  /(^|\r?\n)(\s*(?:export\s+)?(?:[A-Za-z_][A-Za-z0-9_]*[_-])?(?:API[_-]?KEY|SECRET(?:[_-]?KEY)?|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|GITHUB[_-]?TOKEN|NPM[_-]?TOKEN|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|PASSWD|WEBHOOK[_-]?SECRET)\s*=\s*)(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|([^\s#'"\r\n][^\r\n#]{7,}))/gi;

function isPlaceholderSecretValue(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  if (/^(?:\[REDACTED|\$\{[^}]*\}?$|process\.env\b|import\.meta\.env\b|your[_-]|example[_-]?|<[^>]+>$|xxx+$|\*+$|change[_-]?me|replace[_-]?me|insert[_-])/i.test(v)) {
    return true;
  }
  return /^(?:placeholder|todo|null|undefined|true|false|none|test|dummy|sample|changeme)$/i.test(v);
}

function scanSampleWindows(input: string): string[] {
  if (input.length <= MAX_SCAN_CHARS) return [input];
  const windows = [input.slice(0, MAX_SCAN_CHARS)];
  if (input.length > MAX_SCAN_CHARS * 2) {
    const mid = Math.floor(input.length / 2) - Math.floor(MAX_SCAN_CHARS / 2);
    windows.push(input.slice(mid, mid + MAX_SCAN_CHARS));
  }
  windows.push(input.slice(-MAX_SCAN_CHARS));
  return windows;
}

export function detectSecrets(input: string): SecretFinding[] {
  if (!input || input.length < 10) return [];
  const samples = scanSampleWindows(input);

  let privateKeyCount = 0;
  let apiKeyCount = 0;
  let envSecretCount = 0;

  for (const sample of samples) {
    const pkMatches = sample.match(PRIVATE_KEY_BLOCK);
    if (pkMatches) privateKeyCount += pkMatches.length;

    for (const pattern of API_KEY_PATTERNS) {
      const matches = sample.match(new RegExp(pattern.source, pattern.flags));
      if (matches) apiKeyCount += matches.length;
    }

    const uriMatches = sample.match(new RegExp(DB_CREDENTIAL_URI.source, DB_CREDENTIAL_URI.flags));
    if (uriMatches) {
      for (const uri of uriMatches) {
        if (!uri.includes("[REDACTED")) envSecretCount += 1;
      }
    }
    const envRegex = new RegExp(ENV_SECRET_LINE.source, ENV_SECRET_LINE.flags);
    let match: RegExpExecArray | null;
    while ((match = envRegex.exec(sample)) !== null) {
      const val = (match[3] ?? match[4] ?? match[5] ?? "").trim();
      if (!isPlaceholderSecretValue(val)) {
        envSecretCount += 1;
      }
    }
  }

  const findings: SecretFinding[] = [];
  if (privateKeyCount > 0) findings.push({ kind: "private-key", label: "私钥块", count: privateKeyCount });
  if (apiKeyCount > 0) findings.push({ kind: "api-key", label: "API Key / Token", count: apiKeyCount });
  if (envSecretCount > 0) findings.push({ kind: "env-secret", label: ".env / 连接串密钥", count: envSecretCount });
  return findings;
}

export function redactDetectedSecrets(input: string): { text: string; redactedCount: number } {
  let count = 0;
  let output = input.replace(PRIVATE_KEY_BLOCK, () => {
    count += 1;
    return "[REDACTED_PRIVATE_KEY]";
  });

  output = output.replace(DB_CREDENTIAL_URI, (_full, prefix: string, pass: string, at: string) => {
    if (pass.startsWith("[REDACTED")) return `${prefix}${pass}${at}`;
    count += 1;
    return `${prefix}[REDACTED]${at}`;
  });

  output = output.replace(
    ENV_SECRET_LINE,
    (full, newline: string, assignment: string, dqVal?: string, sqVal?: string, bareVal?: string) => {
      const rawVal = (dqVal ?? sqVal ?? bareVal ?? "").trim();
      if (isPlaceholderSecretValue(rawVal)) return full;
      count += 1;
      const quote = dqVal !== undefined ? '"' : sqVal !== undefined ? "'" : "";
      return `${newline}${assignment}${quote}[REDACTED_SECRET]${quote}`;
    },
  );

  for (const pattern of API_KEY_PATTERNS) {
    output = output.replace(new RegExp(pattern.source, pattern.flags), (matched) => {
      count += 1;
      if (/^bearer\s+/i.test(matched)) return "Bearer [REDACTED_TOKEN]";
      return "[REDACTED_API_KEY]";
    });
  }

  return { text: output, redactedCount: count };
}

export interface SecretGuardBarProps {
  text: string;
  onRedact(redactedText: string): void;
  pendingLargePaste?: {
    text: string;
    onConfirmRedacted(): void;
    onConfirmRaw(): void;
    onCancel(): void;
  };
}

export const SecretGuardBar = memo(function SecretGuardBar({
  text,
  onRedact,
  pendingLargePaste,
}: SecretGuardBarProps): React.JSX.Element | null {
  const targetText = pendingLargePaste ? pendingLargePaste.text : text;
  const findings = useMemo(() => detectSecrets(targetText), [targetText]);
  const signature = findings.map((f) => `${f.kind}:${f.count}`).join(",");
  const [dismissedSig, setDismissedSig] = useState("");

  if (findings.length === 0) return null;
  if (!pendingLargePaste && dismissedSig === signature) return null;

  const summary = findings.map((f) => `${f.label} ×${f.count}`).join("、");

  return (
    <div className="secret-guard-bar" role="alert" aria-live="polite">
      <div className="secret-guard-info">
        <ShieldAlert size={15} className="secret-guard-icon" />
        <span>
          <strong>敏感凭据保护：</strong>
          {pendingLargePaste
            ? `粘贴的长文本（>32 KiB）中检测到 ${summary}，建议先脱敏再存为草稿附件。`
            : `输入框中检测到疑似凭据（${summary}），发送前可一键脱敏。`}
        </span>
      </div>

      <div className="secret-guard-actions">
        {pendingLargePaste ? (
          <>
            <button
              type="button"
              className="ui-btn ui-btn-primary ui-btn-sm"
              onClick={pendingLargePaste.onConfirmRedacted}
            >
              一键脱敏并转为附件
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={pendingLargePaste.onConfirmRaw}
            >
              保留原文转附件
            </button>
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-sm"
              aria-label="取消粘贴"
              onClick={pendingLargePaste.onCancel}
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="ui-btn ui-btn-primary ui-btn-sm"
              onClick={() => {
                const { text: next } = redactDetectedSecrets(text);
                onRedact(next);
              }}
            >
              一键脱敏
            </button>
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn-sm"
              aria-label="忽略本次敏感凭据提醒"
              title="忽略本次提醒"
              onClick={() => setDismissedSig(signature)}
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});
