import {expect,it} from "vitest";
import {explainMediaFailure} from "./media-failure";
it("distinguishes gateway credentials, temporary auth, expired login and transport failures",()=>{
 const temporary="暂时无法验证订阅\\nAuthentication is temporarily unavailable. Your session is still signed in; no need to run /login.";
 expect(explainMediaFailure(temporary).action).toBe("network");expect(explainMediaFailure(temporary).summary).not.toContain("请先重新登录");
 expect(explainMediaFailure(`提供商凭据不可用\\n${temporary}`).action).toBe("providers");
 expect(explainMediaFailure("Not signed in: credentials expired").action).toBe("accounts");
 expect(explainMediaFailure('Internal error: "request error stream: error sending request for url (https://cli-chat-proxy.grok.com/v1/responses)"').action).toBe("network");
 expect(explainMediaFailure("生成任务已停止等待，远端完成状态未确认").action).toBe("wait");
 expect(explainMediaFailure("提供商用户环境读取失败").action).toBe("providers");
});
