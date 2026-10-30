"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("renderTags escapes community-submitted tag markup", () => {
  const tagCloud = {
    innerHTML: "",
    querySelectorAll() { return []; },
  };
  const document = {
    addEventListener() {},
    querySelector(selector) {
      assert.equal(selector, "#tag-cloud");
      return tagCloud;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const payload = '\"><img src=x onerror="globalThis.compromised=true">';
  const context = vm.createContext({ document, tagCloud, payload });

  vm.runInContext(`${source}\nstate.sites = [{ tags: [payload] }]; renderTags();`, context);

  assert.doesNotMatch(tagCloud.innerHTML, /<img/i);
  assert.match(tagCloud.innerHTML, /&lt;img/);
  assert.equal(context.compromised, undefined);
});
