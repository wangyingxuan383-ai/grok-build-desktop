import {expect,it} from "vitest";
import {browserAddress} from "./browser-address";
it("supports local development URLs without treating a port as a protocol",()=>{
 expect(browserAddress("localhost:3000/app")).toBe("http://localhost:3000/app");
 expect(browserAddress("127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
 expect(browserAddress("[::1]:8080")).toBe("http://[::1]:8080");
 expect(browserAddress("example.com")).toBe("https://example.com");
 expect(browserAddress("file:///private")).toBe("file:///private");
});
