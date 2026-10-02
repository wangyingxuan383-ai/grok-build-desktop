import {expect,it} from "vitest";
import {buildCells} from "./TokenActivityPanel";
import type {TokenDayBucket} from "../../../shared/types";
it("accumulates child usage consistently in cumulative charts",()=>{
 const days=[{day:"2026-10-01",totalTokens:10,subagentTokens:4,subagentTurns:1,turns:1,turnsWithUsage:1,turnsWithTotal:1,source:"turn-details"},{day:"2026-10-02",totalTokens:20,subagentTokens:6,subagentTurns:2,turns:1,turnsWithUsage:1,turnsWithTotal:1,source:"turn-details"}] as TokenDayBucket[];
 const cumulative=buildCells(days,"total");expect(cumulative[1]?.totalTokens).toBe(30);expect(cumulative[1]?.subagentTokens).toBe(10);expect(cumulative[1]?.subagentTurns).toBe(3);expect(buildCells(days,"daily")[1]?.subagentTokens).toBe(6);
});
