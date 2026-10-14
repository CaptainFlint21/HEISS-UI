import assert from "node:assert/strict";
import test from "node:test";
import { sexTermNotes, sexTermsIn } from "./prompt-terms.js";

const found = (idea) => sexTermsIn(idea).map((term) => idea.match(term.match)[0].toLowerCase());

test("sex terms are found in the way people write them", () => {
  assert.deepEqual(found("redhead riding him cowgirl on the couch"), ["cowgirl"]);
  assert.deepEqual(found("reverse cowgirl, shes facing away from him"), ["reverse cowgirl"]);
  assert.deepEqual(found("two guys spitroasting a girl on a kitchen table"), ["spitroasting"]);
  assert.deepEqual(found("doggystyle in front of a mirror"), ["doggystyle"]);
  assert.deepEqual(found("69 on a hotel bed"), ["69"]);
  assert.deepEqual(found("thick latina getting fucked missionary on a cheap motel bed"), ["missionary"]);
  assert.deepEqual(found("missionary on a sofa, her legs wrapped around him"), ["missionary"]);
  assert.deepEqual(found("brunette giving a handjob in the back seat"), ["handjob"]);
});

test("everyday words stay everyday unless the idea is sexual", () => {
  for (const idea of ["a cowgirl on a horse at sunset", "a missionary teaching kids in a village", "spa day, woman getting a facial",
    "dog sleeping in a doggy bed", "route 69 diner neon sign", "couple spooning on the couch watching tv", "the 69 bus at night"]) {
    assert.deepEqual(sexTermsIn(idea), [], idea);
  }
});

test("the notes say what the term means, with tags only for tag models", () => {
  assert.equal(sexTermNotes("a lighthouse in a storm"), "");
  const prose = sexTermNotes("two guys spitroasting a girl");
  assert.match(prose, /"spitroasting": two men/);
  assert.doesNotMatch(prose, /Tags:/);
  assert.match(sexTermNotes("two guys spitroasting a girl", { tags: true }), /Tags: spitroast, 2boys, 1girl/);
});
