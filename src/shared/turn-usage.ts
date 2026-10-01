import type { TurnUsage } from "./types";

const authority: Record<TurnUsage["source"], number> = { history: 0, "prompt-result": 1, "acp-turn": 2, subagent: 3 };
const fields=["inputTokens","outputTokens","totalTokens","cachedReadTokens","reasoningTokens"] as const;

/** Keep each explicitly reported field and its authority, never manufacture a total. */
export function mergeTurnUsage(previous?: TurnUsage, incoming?: TurnUsage): TurnUsage | undefined {
  if (!incoming) return previous ? structuredClone(previous) : undefined;
  const result:TurnUsage=previous ? {...previous} : {source:incoming.source,exact:true};
  const incomingWins=!previous||authority[incoming.source]>=authority[previous.source];
  if(incomingWins) result.source=incoming.source;
  for(const key of ["modelId","providerId","usageIsIncomplete"] as const) {
    if(incoming[key]!==undefined && (incomingWins || result[key]===undefined)) Object.assign(result,{[key]:incoming[key]});
  }
  result.fieldSources={...previous?.fieldSources};
  for(const field of fields){
    const before=previous?.fieldSources?.[field]??previous?.source;
    const after=incoming.fieldSources?.[field]??incoming.source;
    if(incoming[field]!==undefined && (result[field]===undefined || !before || authority[after]>=authority[before])){
      result[field]=incoming[field];result.fieldSources[field]=after;
    }else if(result[field]!==undefined&&before){result.fieldSources[field]=before;}
  }
  result.mixedSources=new Set(Object.values(result.fieldSources)).size>1;
  return result;
}
