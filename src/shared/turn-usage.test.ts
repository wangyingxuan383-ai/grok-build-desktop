import { describe, expect, it } from "vitest";
import { mergeTurnUsage } from "./turn-usage";

describe("turn usage notification merge",()=>{
 it("keeps missing fields, does not manufacture totals and accepts authoritative corrections",()=>{
  const first={source:"prompt-result" as const,exact:true as const,inputTokens:80,outputTokens:20,totalTokens:100,modelId:"model"};
  const partial=mergeTurnUsage(first,{source:"acp-turn",exact:true,inputTokens:79});
  expect(partial).toMatchObject({source:"acp-turn",inputTokens:79,outputTokens:20,totalTokens:100,modelId:"model"});
  const corrected=mergeTurnUsage(partial,{source:"acp-turn",exact:true,totalTokens:90,outputTokens:11});
  expect(mergeTurnUsage(corrected,first)).toMatchObject({inputTokens:79,outputTokens:11,totalTokens:90});
  expect(mergeTurnUsage(undefined,{source:"acp-turn",exact:true,inputTokens:8,outputTokens:2})?.totalTokens).toBeUndefined();
 });
});

it("retains per-field authority so an early partial notification cannot lock unrelated fields",()=>{
 const original={source:"prompt-result" as const,exact:true as const,totalTokens:100,inputTokens:80,outputTokens:20};
 const partial=mergeTurnUsage(original,{source:"acp-turn",exact:true,inputTokens:79})!;
 expect(partial).toMatchObject({mixedSources:true,fieldSources:{inputTokens:"acp-turn",totalTokens:"prompt-result",outputTokens:"prompt-result"}});
 const correction=mergeTurnUsage(partial,{source:"prompt-result",exact:true,totalTokens:99,outputTokens:21})!;
 expect(correction).toMatchObject({inputTokens:79,totalTokens:99,outputTokens:21});
});
