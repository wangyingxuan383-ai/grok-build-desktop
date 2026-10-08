import { z } from "zod";
import { REMOTE_MUTATIONS, type RemoteCommand } from "../../shared/remote";
import { REASONING_EFFORTS } from "../../shared/types";
const identifier=z.string().min(1).max(256).refine(v=>!/[\u0000-\u001f]/.test(v));
const config={modelId:identifier.optional(),providerId:identifier.optional(),effort:z.enum(REASONING_EFFORTS).optional(),mode:z.enum(["auto","agent","plan"]).optional()};
const tool=z.object({sessionId:identifier,serverName:identifier,toolName:identifier,generation:identifier}).strict();
const references=z.array(z.object({workspaceId:identifier,path:z.string().min(1).max(4096),kind:z.enum(["file","folder"])}).strict()).max(12).optional();
export function extendedRemoteFields(action:string,body:Record<string,unknown>):Partial<RemoteCommand>{
 const schemas:Record<string,z.ZodType>={
  create:z.object({workspaceId:identifier,profileId:identifier.optional(),...config}).strict(),
  configure:z.object({...config,revision:z.string().min(16).max(128)}).strict(),
  send:z.object({text:z.string().min(1).max(65536),attachmentIds:z.array(identifier).max(12).optional(),toolSelection:tool.optional(),references}).strict(),
  interject:z.object({text:z.string().min(1).max(65536),attachmentIds:z.array(identifier).max(12).optional(),toolSelection:tool.optional(),references}).strict(),
  "queue-edit":z.object({queueId:identifier,text:z.string().min(1).max(65536)}).strict(),
  "queue-move":z.object({queueId:identifier,position:z.number().int().min(0).max(1000)}).strict(),
  "queue-clear":z.object({}).strict(),compact:z.object({}).strict(),delete:z.object({}).strict(),fork:z.object({pointId:identifier.optional(),profileId:identifier.optional(),...config}).strict(),
  workbench:z.object({mutation:z.object({kind:z.enum(REMOTE_MUTATIONS),target:identifier.optional(),data:z.record(z.string(),z.unknown()).optional()}).strict()}).strict(),
 };
 const schema=schemas[action];if(!schema)return {};
 const rest=Object.fromEntries(Object.entries(body).filter(([key])=>!["action","sessionId","operationId"].includes(key)));
 const result=schema.safeParse(rest);if(!result.success)throw Error(`参数无效：${result.error.issues.map(i=>i.path.join(".")+" "+i.message).join("；")}`);
 return result.data as Partial<RemoteCommand>;
}
