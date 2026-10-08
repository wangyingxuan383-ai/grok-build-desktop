import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {CACHE_EVICTION_SQL} from "./cache-policy.ts";
test("cache budget counts UTF-8 bytes and preserves drafts outside cache",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE cache(key TEXT PRIMARY KEY,body TEXT,updated INTEGER);CREATE TABLE saved(key TEXT PRIMARY KEY,body TEXT);");
  db.prepare("INSERT INTO saved VALUES(?,?)").run("draft","keep");
  const put=db.prepare("INSERT INTO cache VALUES(?,?,?)");
  put.run("old","中".repeat(100),1);put.run("middle","文".repeat(100),2);put.run("new","字".repeat(100),3);
  db.prepare(CACHE_EVICTION_SQL).run(650);
  assert.deepEqual(db.prepare("SELECT key FROM cache ORDER BY updated").all().map(row=>row.key),["middle","new"]);
  assert.equal(db.prepare("SELECT body FROM saved").get()?.body,"keep");
 }finally{db.close();}
});
