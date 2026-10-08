import { expect, it } from "vitest";
import { appendQuote } from "./QuoteSelection";
it("quotes a selection as a markdown block after the existing draft", () => {
  expect(appendQuote("", "第一行\r\n第二行")).toBe("> 第一行\n> 第二行\n\n");
  expect(appendQuote("请解释：  \n", "a\n\n\n\nb")).toBe("请解释：\n\n> a\n>\n> b\n\n");
  expect(appendQuote("草稿", "   ")).toBe("草稿");
  expect(appendQuote("", "x".repeat(9000)).length).toBe(8000 + 4);
});
