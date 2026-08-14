import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Attachment, ComposerCapabilitySelection, NewTaskDraft } from "../../../shared/types";
import { hasSessionSubmission } from "../session-submission-state";
import { shouldApplyDraftHydration } from "../session-ui-guards";

/** Owns the composer state that must never bleed between concurrent sessions. */
export function useSessionDraft(input: {
  activeSessionId: string;
  workspace: string;
  newDraftKey?: string;
  foreignSessionOpen: boolean;
  sendingSessionIds: ReadonlySet<string>;
  attachments: Attachment[];
  clearAttachments(): void;
  addAttachments(values: Attachment[]): void;
  onSessionChange(): void;
  onError(error: unknown): void;
}): {
  draftKey: string;
  activeSending: boolean;
  composer: string;
  setComposer: React.Dispatch<React.SetStateAction<string>>;
  capability: ComposerCapabilitySelection | undefined;
  setCapability: React.Dispatch<React.SetStateAction<ComposerCapabilitySelection | undefined>>;
  newTask: NewTaskDraft | undefined;
  setNewTask: React.Dispatch<React.SetStateAction<NewTaskDraft | undefined>>;
  discardCurrentDraft(): Promise<void>;
} {
  const [composer, setComposerState] = useState("");
  const [capability, setCapabilityState] = useState<ComposerCapabilitySelection>();
  const [newTask, setNewTaskState] = useState<NewTaskDraft>();
  const [loadedKey, setLoadedKey] = useState("");
  const loadGenerationRef = useRef(0);
  const touchedGenerationRef = useRef(0);
  const attachmentRevisionRef = useRef(0);
  const attachmentFingerprint = fingerprintAttachments(input.attachments);
  const previousAttachmentFingerprintRef = useRef(attachmentFingerprint);
  const ignoredAttachmentFingerprintsRef = useRef(new Set<string>());
  const saveTimerRef = useRef<number | undefined>(undefined);
  const draftKey = input.activeSessionId || input.newDraftKey || (input.workspace ? `new:${input.workspace}` : "");
  const activeSending = hasSessionSubmission(input.sendingSessionIds, input.activeSessionId, draftKey);

  const setComposer = useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => {
    if (loadGenerationRef.current) touchedGenerationRef.current = loadGenerationRef.current;
    setComposerState(value);
  }, []);
  const setCapability = useCallback<React.Dispatch<React.SetStateAction<ComposerCapabilitySelection | undefined>>>((value) => {
    if (loadGenerationRef.current) touchedGenerationRef.current = loadGenerationRef.current;
    setCapabilityState(value);
  }, []);
  const setNewTask = useCallback<React.Dispatch<React.SetStateAction<NewTaskDraft | undefined>>>((value) => {
    if (loadGenerationRef.current) touchedGenerationRef.current = loadGenerationRef.current;
    setNewTaskState(value);
  }, []);

  const discardCurrentDraft = useCallback(async (): Promise<void> => {
    const key = draftKey;
    if (!key) return;
    // Invalidate an in-flight hydration and suspend autosave for this still
    // mounted key. Without this, the render caused by clearing the fields can
    // schedule a new empty draft immediately after clearDraft succeeds.
    loadGenerationRef.current += 1;
    touchedGenerationRef.current = loadGenerationRef.current;
    setLoadedKey("");
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    // Clear renderer state before deleting the persisted row. This cancels the
    // pending autosave render and prevents a prompt-containing draft from
    // being recreated immediately after the user deletes it.
    setComposerState("");
    setCapabilityState(undefined);
    setNewTaskState(undefined);
    ignoredAttachmentFingerprintsRef.current.add("");
    input.clearAttachments();
    await window.grokDesktop.clearDraft(key);
  }, [draftKey, input.clearAttachments]);

  useLayoutEffect(() => {
    if (previousAttachmentFingerprintRef.current === attachmentFingerprint) return;
    previousAttachmentFingerprintRef.current = attachmentFingerprint;
    if (ignoredAttachmentFingerprintsRef.current.delete(attachmentFingerprint)) return;
    attachmentRevisionRef.current += 1;
  }, [attachmentFingerprint]);

  useLayoutEffect(() => {
    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    touchedGenerationRef.current = 0;
    setLoadedKey("");
    input.onSessionChange();
    setComposerState("");
    setCapabilityState(undefined);
    setNewTaskState(undefined);
    ignoredAttachmentFingerprintsRef.current.clear();
    ignoredAttachmentFingerprintsRef.current.add("");
    input.clearAttachments();
    const baselineAttachmentRevision = attachmentRevisionRef.current;
    if (!draftKey || input.foreignSessionOpen) return () => { cancelled = true; };
    void (async () => {
      let draft = await window.grokDesktop.getDraft(draftKey);
      const legacyKey = !input.activeSessionId && input.workspace ? `new:${input.workspace}` : "";
      if (!draft && legacyKey && legacyKey.toLocaleLowerCase() !== draftKey.toLocaleLowerCase()) {
        const legacy = await window.grokDesktop.getDraft(legacyKey);
        if (legacy) draft = await window.grokDesktop.moveDraft(legacyKey, draftKey);
      }
      if (shouldApplyDraftHydration({
        cancelled,
        generation,
        currentGeneration: loadGenerationRef.current,
        touchedGeneration: touchedGenerationRef.current,
        baselineAttachmentRevision,
        currentAttachmentRevision: attachmentRevisionRef.current,
      })) {
        setComposerState(draft?.text || "");
        setCapabilityState(draft?.capability);
        setNewTaskState(draft?.newTask);
        const restoredAttachments = draft?.attachments ?? [];
        ignoredAttachmentFingerprintsRef.current.add("");
        ignoredAttachmentFingerprintsRef.current.add(fingerprintAttachments(restoredAttachments));
        input.clearAttachments();
        if (restoredAttachments.length) input.addAttachments(restoredAttachments);
      }
      if (!cancelled && generation === loadGenerationRef.current) setLoadedKey(draftKey);
    })().catch(() => {
      if (!cancelled && generation === loadGenerationRef.current) setLoadedKey(draftKey);
    });
    return () => { cancelled = true; };
  }, [draftKey, input.foreignSessionOpen, input.onSessionChange, input.clearAttachments, input.addAttachments]);

  useEffect(() => {
    if (!draftKey || loadedKey !== draftKey || input.foreignSessionOpen || activeSending) return;
    const timer = window.setTimeout(() => {
      if (saveTimerRef.current === timer) saveTimerRef.current = undefined;
      void window.grokDesktop.setDraft(draftKey, composer, capability, input.attachments, newTask).catch(input.onError);
    }, 250);
    saveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimerRef.current === timer) saveTimerRef.current = undefined;
    };
  }, [composer, capability, input.attachments, newTask, draftKey, loadedKey, input.foreignSessionOpen, activeSending, input.onError]);

  return { draftKey, activeSending, composer, setComposer, capability, setCapability, newTask, setNewTask, discardCurrentDraft };
}

function fingerprintAttachments(values: Attachment[]): string {
  return values.map((value) => `${value.id}\u0000${value.kind}\u0000${value.path || ""}\u0000${value.name}\u0000${value.size}`).join("\u0001");
}
