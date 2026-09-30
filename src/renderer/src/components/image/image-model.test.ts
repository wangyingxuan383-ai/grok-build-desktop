import { expect, it } from "vitest";
import type { ImageConversation } from "../../../../shared/image-workspace";
import { collectMisses, collectWorks } from "./image-model";

it("keeps verified pictures from partially failed or cancelled jobs without duplicate failure tiles", () => {
  const row: ImageConversation={id:"image-one",title:"one",cwd:"C:/images",createdAt:"",updatedAt:"",draft:"",jobs:[
    {requestId:"a",prompt:"a",job:{jobId:"a",sessionId:"image-one",status:"failed",route:"cli",kind:"image",message:"partial",startedAt:"",updatedAt:"",artifacts:[{id:"good",media:"image",source:"grok-media://access/one"}]}},
    {requestId:"b",prompt:"b",job:{jobId:"b",sessionId:"image-one",status:"failed",route:"cli",kind:"image",message:"failed",startedAt:"",updatedAt:"",artifacts:[]}},
  ]};
  expect(collectWorks([row]).map(work=>work.artifact.id)).toEqual(["good"]);
  expect(collectMisses([row]).map(miss=>miss.record.job.jobId)).toEqual(["b"]);
});
