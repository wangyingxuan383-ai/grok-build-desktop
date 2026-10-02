import {expect,it} from "vitest";
import {parsePullRequest} from "./pull-request-service";
it("combines check-run and commit-context results without reporting pending as complete",()=>{
 const pending=parsePullRequest({number:4,url:"https://github.com/example/project/pull/4",statusCheckRollup:[{name:"build",status:"IN_PROGRESS",conclusion:""},{context:"lint",state:"SUCCESS"}]});
 expect(pending.pending).toBe(true);expect(pending.checks.map(row=>row.name)).toEqual(["build","lint"]);
 expect(parsePullRequest({statusCheckRollup:[{name:"build",conclusion:"FAILURE",status:"COMPLETED"}]}).pending).toBe(false);
 expect(parsePullRequest({url:"javascript:alert(1)"}).url).toBeUndefined();
});
