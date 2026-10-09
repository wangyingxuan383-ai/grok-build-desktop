import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { api, listen,discoverComputers, type HostConnection } from "./transport";
import { ConnectionManager, type ConnectionState } from "./connection";
import { mergeEventWindows, type WireEvent } from "./remote-model";
import { draftKey, readDraft, preservePairingDrafts } from "./draft-store";
import {cacheRead,cacheWrite,savedRead,savedWrite} from "./cache";
import { isTransientError, readableActionError } from "./connection-errors";
import type {
  RemoteCommand,
  RemoteReceipt,
  RemoteSession,
  RemoteSnapshot,
  RemoteOptions,
} from "../../../src/shared/remote";

export interface Outgoing {
  command: RemoteCommand;
  createdAt: string;
  composer?:{attachmentIds:string[];attachments:Array<{id:string;name:string;size:number}>;toolSelection?:RemoteCommand["toolSelection"];references?:RemoteCommand["references"]};
}
const storageKey = (host: HostConnection, kind: string) =>
  `grok.remote.${host.id}.${kind}`;
const initialConnection: ConnectionState = {
  phase: "connecting",
  mode: "live",
  failures: 0,
};
const message = (error: unknown) => readableActionError(error);
export function useRemote(host?: HostConnection,onEndpointRecovered?:(host:HostConnection)=>Promise<void>, visible=true) {
  const visibleRef=useRef(visible);visibleRef.current=visible;
  const [cachedAt,setCachedAt]=useState<number>(),[composer,setComposerState]=useState<NonNullable<Outgoing["composer"]>>({attachmentIds:[],attachments:[]});
  const composerRef=useRef(composer);composerRef.current=composer;
  const composerRevision=useRef(0);
  const listFresh=useRef(""), snapshotFresh=useRef("");
  const [materialsReady,setMaterialsReady]=useState(false);
  const lastComputer=useRef(""),recoveryProbe=useRef(0),recoverEndpoint=useRef(onEndpointRecovered);recoverEndpoint.current=onEndpointRecovered;
  const [sessions, setSessions] = useState<RemoteSession[]>([]),
    [sessionId, setSessionId] = useState("");
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>(),
    [older, setOlder] = useState<WireEvent[]>([]),
    [before, setBefore] = useState<number>();
  const [anchorIndex,setAnchorIndex]=useState<number>();
  const selectedParent=useRef<string|undefined>(undefined);selectedParent.current=snapshot?.session.parentSessionId;
  const [connection, setConnection] =
      useState<ConnectionState>(initialConnection),
    [error, setError] = useState("");
  const [options, setOptions] = useState<RemoteOptions>(),
    [optionsLoading,setOptionsLoading]=useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [optionsError,setOptionsError]=useState("");
  const optionsFlights=useRef(new Map<string,Promise<RemoteOptions>>());
  const [draft, setDraftState] = useState(""),
    [unknown, setUnknown] = useState<Outgoing>(),
    [receipt, setReceipt] = useState<RemoteReceipt>();
  const [submitted, setSubmitted] = useState<Outgoing>(),
    [notice, setNoticeState] = useState(""),
    [noticeTarget, setNoticeTarget] = useState<string>();
  const [readError, setReadError] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const setNotice = useCallback((text: string, target?: string) => {
    setNoticeState(text);
    setNoticeTarget(target);
  }, []);
  const creationPending =
    ["create","fork"].includes(receipt?.action || "") &&
    ["accepted", "queued", "running"].includes(receipt?.state || "");
  const manager = useRef<ConnectionManager | undefined>(undefined),
    clock = useRef(0),
    active = useRef({ host, sessionId, draft }),
    mounted = useRef(true);
  active.current = { host, sessionId, draft };
  const snapshotVersion = useRef(0),
    writes = useRef(Promise.resolve()),
    drafts = useRef(new Map<string, string>());
  const hydrated = useRef(false),
    draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    writeLock = useRef(false),
    historyLoaded = useRef(false),
    historyCount = useRef(0),
    draftRevision = useRef(0);
  const write = useCallback((key: string, value: string | null) => {
    const next = writes.current.then(() =>
      value === null
        ? AsyncStorage.removeItem(key)
        : AsyncStorage.setItem(key, value),
    );
    writes.current = next.catch(() => undefined);
    return next;
  }, []);
  const flushDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const value = active.current;
    if (!value.host || !value.sessionId || !hydrated.current)
      return Promise.resolve();
    const key = draftKey(value.host, value.sessionId);
    return write(key, drafts.current.get(key) ?? value.draft);
  }, [write]);
  const snapshotFailures = useRef(0), snapshotRetry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refreshSnapshot = useCallback(async () => {
    const target = active.current;
    if (!target.host || !target.sessionId) return;
    if (snapshotRetry.current) { clearTimeout(snapshotRetry.current); snapshotRetry.current = undefined; }
    const version = ++snapshotVersion.current;
    try {
      const value = await api<RemoteSnapshot>(
        target.host,
        // read=1: viewing it here clears the computer's unread mark too (only while on screen).
        `/v1/sessions/${encodeURIComponent(target.sessionId)}${visibleRef.current && AppState.currentState === "active" ? "?read=1" : ""}`,
      );
      if (value.session.id !== target.sessionId)
        throw Object.assign(
          Error("电脑返回的会话身份不匹配，请重新打开列表中的会话"),
          { status: 409 },
        );
      if (
        !mounted.current ||
        version !== snapshotVersion.current ||
        active.current.host?.id !== target.host.id ||
        active.current.sessionId !== target.sessionId
      )
        return;
      if (value.totalEvents < historyCount.current) {
        setOlder([]);
        historyLoaded.current = false;
      }
      historyCount.current = value.totalEvents;
      if (!historyLoaded.current) setBefore(value.before);
      setSnapshot(value);
      snapshotFresh.current=`${target.host.fingerprint}:session:${target.sessionId}`;setCachedAt(undefined);void cacheWrite(`${target.host.fingerprint}:session:${target.sessionId}`,value).catch(()=>undefined);
      setReadError("");
      snapshotFailures.current = 0;
    } catch (e) {
      if ((e as {status?:number;code?:string}).status===401 || ["ERR_REMOTE_IDENTITY","ERR_REMOTE_CERT_TIME"].includes((e as {code?:string}).code||"")) throw e;
      const current = () => version === snapshotVersion.current &&
        active.current.sessionId === target.sessionId &&
        active.current.host?.fingerprint === target.host?.fingerprint;
      // A Wi-Fi hiccup or a busy computer usually clears within seconds: retry quietly
      // twice before telling the user, instead of flashing a red strip on every blip.
      if (isTransientError(e) && ++snapshotFailures.current < 3) {
        if (current()) snapshotRetry.current = setTimeout(() => { snapshotRetry.current = undefined; if (current()) void refreshSnapshotRef.current().catch(() => undefined); }, 1200 * snapshotFailures.current);
        return;
      }
      if (current()) setReadError(message(e));
    }
  }, []);
  const refreshSnapshotRef = useRef(refreshSnapshot); refreshSnapshotRef.current = refreshSnapshot;
  const refreshList = useCallback(async (connection: HostConnection) => {
    const value = await api<{
      sessions: RemoteSession[];
      cursor: number;
      epoch: string;
      serverTime: number;
    }>(connection, "/v1/sessions");
    if (mounted.current && active.current.host?.id === connection.id) {
      clock.current = value.serverTime - Date.now();
      setSessions(value.sessions);
      listFresh.current=connection.fingerprint;
      void cacheWrite(`${connection.fingerprint}:sessions`,value.sessions).catch(()=>undefined);
    }
    return value;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void flushDraft();
    };
  }, [flushDraft]);
  useEffect(() => {
    if (!host) {
      setSessions([]);
      setSessionId("");
      setSnapshot(undefined);
      setOptions(undefined);
      setUnknown(undefined);
      return;
    }
    let disposed = false;
    if(lastComputer.current!==host.fingerprint){setSessions([]);setSessionId("");setSnapshot(undefined);setOlder([]);setComposerState({attachmentIds:[],attachments:[]})}lastComputer.current=host.fingerprint;
    listFresh.current="";void cacheRead<RemoteSession[]>(`${host.fingerprint}:sessions`).then(cached=>{if(!disposed&&cached&&listFresh.current!==host.fingerprint){setSessions(cached.value);setCachedAt(cached.updated)}}).catch(()=>undefined);
    setRecoveryReady(false);
    setSubmitted(undefined);
    setReceipt(undefined);
    void Promise.all([
      AsyncStorage.getItem(storageKey(host, "unknown")),
      AsyncStorage.getItem(storageKey(host, "last-submission")),
    ])
      .then(([pending, last]) => {
        if (disposed) return;
        setUnknown(pending ? JSON.parse(pending) : undefined);
        if (last) {
          const outgoing = JSON.parse(last) as Outgoing;
          if (
            Date.now() - Date.parse(outgoing.createdAt) < 7 * 86400000 &&
            outgoing.command?.operationId
          ) {
            setSubmitted(outgoing);
            void api<RemoteReceipt>(
              host,
              `/v1/operations/${outgoing.command.operationId}`,
            )
              .then((value) => {
                if (!disposed) setReceipt(value);
              })
              .catch(() => undefined);
          }
        }
      })
      .then(() => {
        if (!disposed) setRecoveryReady(true);
      })
      .catch(() => {
        if (!disposed)
          setError(
            "本机提交状态恢复失败，请先在电脑核对上次结果，再重新打开应用。",
          );
      });
    setOptions(undefined);
    let optionsLoaded = false;
    const owner = new ConnectionManager({
      read: async () => {
        let info:{protocol:number};try{info=await api<{protocol:number}>(host,"/v1/info")}catch(error){
          if(Date.now()-recoveryProbe.current>180000&&recoverEndpoint.current&&(error as {code?:string}).code!=="ERR_REMOTE_IDENTITY"){
            recoveryProbe.current=Date.now();try{const candidates=await discoverComputers();const candidate=candidates.find(row=>row.fingerprint===host.fingerprint&&row.host!==host.host);if(candidate){await api({...host,host:candidate.host},"/v1/info");await recoverEndpoint.current({...host,host:candidate.host})}}catch{}
          }throw error;
        }
        if (info.protocol !== 1)
          throw Object.assign(Error("电脑与手机协议不同，请更新配套版本"), {
            code: "ERR_REMOTE_PROTOCOL",
          });
        const value = await refreshList(host);
        if (!optionsLoaded) {
          optionsLoaded = true;
          void api<RemoteOptions>(host, "/v1/options?models=refresh")
            .then((value) => {
              if (!disposed) setOptions(value);
            })
            .catch((e) => {
              if ((e as { status?: number }).status === 404) {
                if (!disposed) setOptions({ capabilities: [], workspaces: [] });
              } else optionsLoaded = false;
            });
        }
        // Computer reachability was established by /info and /sessions.
        // A single historical conversation failing must not mark it offline.
        void refreshSnapshot().catch(() => undefined);
        return value;
      },
      stream: (cursor, epoch, data, fail) =>
        listen(host, cursor, epoch, data, fail),
      refresh: async (ids) => {
        const value = active.current;
        if (!ids || ids.includes(value.sessionId)||ids.includes(selectedParent.current??"")) await refreshSnapshot();
        await refreshList(host);
      },
      state: (value) => {
        if (!disposed) {
          setConnection(value);
          if (value.phase === "online")
            setError((previous) =>
              previous.startsWith("连接中断") || isTransientError(previous) ? "" : previous,
            );
        }
      },
    });
    manager.current = owner;
    if (AppState.currentState === "active" || AppState.currentState == null)
      owner.start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") owner.start();
      else {
        owner.stop();
        void flushDraft();
        setConnection({ phase: "paused", mode: "live", failures: 0 });
      }
    });
    return () => {
      disposed = true;
      owner.stop();
      sub.remove();
      if (manager.current === owner) manager.current = undefined;
    };
  }, [
    host?.id,
    host?.host,
    host?.fingerprint,
    host?.token,
    refreshList,
    refreshSnapshot,
    flushDraft,
  ]);
  useEffect(() => {
    snapshotVersion.current++;
    setSnapshot(undefined);
    snapshotFailures.current = 0;
    setAnchorIndex(undefined);
    setOlder([]);
    setBefore(undefined);
    setError("");
    setReadError("");
    historyCount.current = 0;
    historyLoaded.current = false;
    hydrated.current = false;
    if (!host || !sessionId) {
      setDraftState("");
      return;
    }
    const key = draftKey(host, sessionId);
    let disposed = false;
    const cached = drafts.current.get(key);
    const revision = draftRevision.current;
    setDraftState(cached ?? "");
    void (
      cached !== undefined
        ? Promise.resolve(cached)
        : readDraft(AsyncStorage, host, sessionId)
    )
      .then((value) => {
        if (!disposed) {
          if (draftRevision.current === revision) {
            drafts.current.set(key, value || "");
            active.current.draft = value || "";
            setDraftState(value || "");
            if (value !== null) void write(key, value);
          }
          hydrated.current = true;
        }
      })
      .catch(() => {
        if (!disposed) hydrated.current = true;
      });
    setLoading(true);
    void refreshSnapshot()
      .catch(() => manager.current?.refresh())
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [host?.id, sessionId, refreshSnapshot, write]);
  const setDraft = useCallback(
    (value: string) => {
      draftRevision.current++;
      active.current.draft = value;
      setDraftState(value);
      const target = active.current;
      if (!target.host || !target.sessionId) return;
      const key = draftKey(target.host, target.sessionId);
      drafts.current.set(key, value);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        void write(key, value);
      }, 300);
    },
    [write],
  );
  const selectSession = useCallback(
    (id: string) => {
      void flushDraft();
      snapshotVersion.current++;
      setMaterialsReady(false);
      setComposerState({attachmentIds:[],attachments:[]});
      composerRef.current={attachmentIds:[],attachments:[]};
      setSessionId(id);
    },
    [flushDraft],
  );
  const settle = useCallback(
    async (
      value: RemoteReceipt,
      outgoing: Outgoing,
      connection: HostConnection,
    ) => {
      if (!mounted.current || active.current.host?.id !== connection.id) return;
      setReceipt(value);
      setSubmitted(outgoing);
      if (value.state === "unknown") {
        setError("电脑重新启动后无法确认执行结果。请先查看会话，再结束核对。");
        return;
      }
      setUnknown(undefined);
      await write(storageKey(connection, "unknown"), null).catch(() => {
        setNotice("电脑已接收；手机回执缓存未保存，请稍后刷新核对。");
      });
      if (
        ["send", "interject"].includes(outgoing.command.action) &&
        value.state !== "failed" &&
        active.current.sessionId === outgoing.command.sessionId &&
        active.current.draft === outgoing.command.text
      ) {
        setDraft("");
      }
      if (value.state === "failed") setError(value.message || "操作失败");
      else if (
        ["rename", "archive", "queue-remove"].includes(outgoing.command.action)
      )
        setNotice(
          value.state === "completed" ? "操作已完成" : "电脑已接收，正在处理",
        );
      manager.current?.refresh();
    },
    [write, setDraft, selectSession],
  );
  const perform = useCallback(
    async (
      action: RemoteCommand["action"],
      extra: Partial<RemoteCommand> = {},
      targetId?: string,
    ) => {
      const target = active.current;
      if (!target.host || writeLock.current) return;
      if (!recoveryReady) {
        setError("正在恢复本机提交状态，请稍候再发送。");
        return;
      }
      if (creationPending) {
        setError("新会话正在建立，请稍候；已有会话和草稿仍可查看。");
        return;
      }
      if (unknown) {
        setError("上次提交结果待确认，请先核对回执");
        return;
      }
      if (["send","interject"].includes(action) && !materialsReady) {setError("正在恢复当前会话的材料草稿，请稍候。");return;}
      if (action === "send" && !target.draft.trim()) return;
      if (
        action === "send" &&
        encodeURIComponent(target.draft).replace(/%[0-9A-F]{2}/g, "x").length >
          65536
      ) {
        setError("消息超过 64 KiB，请拆分发送；草稿已保留。");
        return;
      }
      const connection = target.host;
      writeLock.current = true;
      setBusy(true);
      setError("");
      const command: RemoteCommand = {
        operationId: `${Date.now() + clock.current}_${Crypto.randomUUID()}`,
        sessionId: targetId || target.sessionId || "new",
        action,
        ...extra,
        ...(["send","interject"].includes(action) ? { text: target.draft,...(composerRef.current.attachmentIds.length?{attachmentIds:composerRef.current.attachmentIds}:{}),...(composerRef.current.toolSelection?{toolSelection:composerRef.current.toolSelection}:{}),...(composerRef.current.references?.length?{references:composerRef.current.references}:{}) } : {}),
      };
      const outgoing:Outgoing = { command, createdAt: new Date().toISOString(),...(["send","interject"].includes(action)?{composer:composerRef.current}:{}) };
      setReceipt(undefined);
      setSubmitted(outgoing);
      try {
        await flushDraft();
        await write(
          storageKey(connection, "unknown"),
          JSON.stringify(outgoing),
        );
        await write(
          storageKey(connection, "last-submission"),
          JSON.stringify(outgoing),
        );
        setUnknown(outgoing);
        const value = await api<RemoteReceipt>(
          connection,
          "/v1/operations",
          command,
        );
        await settle(value, outgoing, connection);
        return value;
      } catch (e) {
        if (
          (e as { status?: number }).status &&
          Number((e as { status?: number }).status) < 500
        ) {
          await write(storageKey(connection, "unknown"), null);
          setUnknown(undefined);
          setError(message(e));
        } else setError("连接中断，提交结果待确认。先核对回执，避免重复执行。");
      } finally {
        writeLock.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [unknown, write, settle, flushDraft, creationPending, recoveryReady, materialsReady],
  );
  const checkUnknown = useCallback(
    async (retry = false) => {
      const connection = active.current.host;
      if (!connection || !unknown || writeLock.current) return;
      writeLock.current = true;
      setBusy(true);
      try {
        const value = retry
          ? await api<RemoteReceipt>(
              connection,
              "/v1/operations",
              unknown.command,
            )
          : await api<RemoteReceipt>(
              connection,
              `/v1/operations/${unknown.command.operationId}`,
            );
        await settle(value, unknown, connection);
      } catch (e) {
        setError(
          (e as { status?: number }).status === 404
            ? "电脑没有这次回执。可用原 ID 重试，避免新建重复请求。"
            : message(e),
        );
      } finally {
        writeLock.current = false;
        setBusy(false);
      }
    },
    [unknown, settle],
  );
  useEffect(() => {
    if (
      !host ||
      !receipt ||
      !submitted ||
      !["accepted", "queued", "running"].includes(receipt.state)
    )
      return;
    let pending = false,
      disposed = false;
    const poll = () => {
      if (pending || AppState.currentState !== "active") return;
      pending = true;
      void api<RemoteReceipt>(host, `/v1/operations/${receipt.operationId}`)
        .then((value) => {
          if (disposed) return;
          setReceipt(value);
          if (value.state === "failed") setError(value.message || "操作失败");
          if (
            value.state === "completed" &&
            ["rename", "archive", "queue-remove"].includes(value.action)
          )
            setNotice("操作已完成");
          if (["completed", "failed", "cancelled"].includes(value.state))
            manager.current?.refresh();
        })
        .catch(() => manager.current?.refresh())
        .finally(() => {
          pending = false;
        });
    };
    const timer = setInterval(poll, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [
    host?.id,
    receipt?.operationId,
    receipt?.state,
    submitted?.command.operationId,
    selectSession,
  ]);
  const loadEarlier = useCallback(async () => {
    const target = active.current;
    if (!target.host || before === undefined || loading) return;
    setLoading(true);
    try {
      const value = await api<RemoteSnapshot>(
        target.host,
        `/v1/sessions/${encodeURIComponent(target.sessionId)}?before=${before}`,
      );
      if (
        active.current.host?.id !== target.host.id ||
        active.current.sessionId !== value.session.id
      )
        return;
      historyLoaded.current = true;
      setOlder((old) => mergeEventWindows(value.events as WireEvent[], old));
      setBefore(value.before);
    } catch (e) {
      // Older history is optional reading; a transient failure is retried on the next scroll.
      if (!isTransientError(e)) setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [before, loading]);
  const loadAround=useCallback(async(index:number)=>{const target=active.current;if(!target.host||!target.sessionId)return;setAnchorIndex(undefined);const result=await api<RemoteSnapshot>(target.host,`/v1/sessions/${encodeURIComponent(target.sessionId)}?around=${index}`);if(active.current.host?.id!==target.host.id||active.current.sessionId!==target.sessionId)return;historyLoaded.current=true;setOlder(old=>mergeEventWindows(result.events as WireEvent[],old));setBefore(result.before);setAnchorIndex(index)},[]);
  const loadOptions = useCallback(async (modelsOnly=false) => {
    if (!host) return;
    const key=`${host.fingerprint}:${host.host}:${modelsOnly}`;
    const pending=optionsFlights.current.get(key);if(pending)return pending;
    setOptionsLoading(true);setOptionsError("");
    const flight=api<RemoteOptions>(host,"/v1/options?models=refresh"+(modelsOnly?"&scope=models":""))
      .then(value=>{if(active.current.host?.fingerprint===host.fingerprint)setOptions(current=>modelsOnly?{...value,workspaces:current?.workspaces??[]}:value);return value})
      .catch(error=>{if(active.current.host?.fingerprint===host.fingerprint)setOptionsError(message(error));throw error})
      .finally(()=>{optionsFlights.current.delete(key);if(active.current.host?.fingerprint===host.fingerprint)setOptionsLoading([...optionsFlights.current.keys()].some(key=>key.startsWith(host.fingerprint+":")))});
    optionsFlights.current.set(key,flight);return flight;
  }, [host]);
  useEffect(()=>{
    if(!host||!options?.modelCatalog?.refreshing)return;
    let cancelled=false;
    const timer=setTimeout(()=>void api<RemoteOptions>(host,"/v1/options?scope=models").then(value=>{
      if(!cancelled&&active.current.host?.fingerprint===host.fingerprint){setOptions(current=>({...value,workspaces:current?.workspaces??[]}));setOptionsError("")}
    }).catch(e=>{if(!cancelled)setOptionsError("模型目录刷新失败："+message(e))}),2000);
    return ()=>{cancelled=true;clearTimeout(timer)};
  },[host,options]);
  const query=useCallback(async<T,>(kind:string,params:Record<string,string>={}):Promise<T>=>{const target=active.current.host;if(!target)throw Error("请先连接电脑");return api<T>(target,"/v1/workbench?"+new URLSearchParams({kind,...params}).toString())},[]);
  const mutate=useCallback((kind:NonNullable<RemoteCommand["mutation"]>["kind"],target:string,data:Record<string,unknown>={})=>perform("workbench",{mutation:{kind,target,data}},target||"global"),[perform]);
  const setComposer=useCallback((value:typeof composer,binding?:{fingerprint:string;sessionId:string})=>{const target=active.current;const owner=binding??(target.host?{fingerprint:target.host.fingerprint,sessionId:target.sessionId}:undefined);if(!owner)return;if(target.host?.fingerprint===owner.fingerprint&&target.sessionId===owner.sessionId){composerRevision.current++;setMaterialsReady(true);composerRef.current=value;setComposerState(value)}void savedWrite(`${owner.fingerprint}:composer:${owner.sessionId}`,value).catch(()=>setError("材料选择保存失败，请保留此页面后重试"))},[]);
  useEffect(()=>{if(!host||!sessionId)return;setMaterialsReady(false);let cancelled=false;const revision=++composerRevision.current;const key=`${host.fingerprint}:session:${sessionId}`;void cacheRead<RemoteSnapshot>(key).then(cached=>{if(!cancelled&&cached&&active.current.sessionId===sessionId&&snapshotFresh.current!==key){setSnapshot(current=>current??cached.value);setCachedAt(cached.updated)}}).catch(()=>undefined);void savedRead<typeof composer>(`${host.fingerprint}:composer:${sessionId}`).then(value=>{if(!cancelled&&revision===composerRevision.current){const next=value??{attachmentIds:[],attachments:[]};composerRef.current=next;setComposerState(next);setMaterialsReady(true)}}).catch(()=>{if(!cancelled)setError("材料草稿恢复失败，请重新打开会话，或明确重新选择材料。")});return()=>{cancelled=true}},[host?.id,sessionId]);
  useEffect(()=>{if(receipt?.state!=="failed"&&receipt?.state!=="cancelled"&&["send","interject"].includes(receipt?.action || "")&&submitted?.command.sessionId===sessionId&&submitted?.composer&&JSON.stringify(submitted.composer)===JSON.stringify(composerRef.current))setComposer({attachmentIds:[],attachments:[]});},[receipt?.state,receipt?.operationId]);
  const reconnect = useCallback(() => manager.current?.start(), []);
  const refreshLock = useRef(false);
  const manualRefresh = useCallback(async () => {
    const target = active.current.host;
    if (!target || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      await refreshList(target);
      await refreshSnapshot();
    } catch (e) {
      setReadError(`刷新未完成：${message(e)}`);
      manager.current?.refresh();
    } finally {
      refreshLock.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [refreshList, refreshSnapshot]);
  const preserveDrafts = useCallback(async () => {
    await flushDraft();
    await writes.current;
    const target = active.current.host;
    if (target) await preservePairingDrafts(AsyncStorage, target);
  }, [flushDraft]);
  const acknowledgeUnknown = async () => {
    if (host) {
      await write(storageKey(host, "unknown"), null);
      setUnknown(undefined);
      setError("");
    }
  };
  return {
    sessions,
    sessionId,
    selectSession,
    snapshot,
    older,
    before,
    connection,
    error,
    readError,
    setError: (value: string) => {
      setError(value);
      if (!value) setReadError("");
    },
    options,
    optionsLoading,
    optionsError,
    loadOptions,
    busy,
    loading,
    draft,
    setDraft,
    unknown,
    receipt,
    submitted,
    creationPending,
    recoveryReady,
    perform,
    checkUnknown,
    acknowledgeUnknown,
    loadEarlier,
    loadAround,anchorIndex,
    reconnect,
    refresh: manualRefresh,
    refreshing,
    preserveDrafts,
    notice,
    setNotice,
    noticeTarget,
    host,query,mutate,composer,setComposer,cachedAt,materialsReady,
    restoreMaterials:()=>{if(submitted?.composer&&submitted.command.sessionId===sessionId)setComposer(submitted.composer)},
  };
}
