const fs = require("fs");
const t = fs
  .readFileSync("D:/Unreal Engine/Light_n_Shadow/Content/BluePrint/BP_WallShadowLogic.uasset")
  .toString("latin1");

const needles = [
  "Slot Onwers",
  "Cube1",
  "Cube2",
  "Cube3",
  "Cube4",
  "Make Array",
  "Get Overlapping",
  "For Each Loop",
  "Collision For All",
  "Begin Overlap",
  "GenerateOverlapEvents",
  "Last Index",
  "First Index",
  "Check Overlapping",
  "Update All",
  "Update Shadow",
  "MemberName=\"Cube1",
  "MemberName=\"Cube2",
  "Array_Add",
  "Array_Clear",
];

console.log("Get Overlapping count:", (t.match(/Get Overlapping Actors/g) || []).length);
console.log("For Each count:", (t.match(/For Each Loop/g) || []).length);
console.log("Array_Add in graph refs:", (t.match(/Array_Add/g) || []).length);

function around(s, n = 4) {
  let i = 0;
  let c = 0;
  while ((i = t.indexOf(s, i)) >= 0 && c < n) {
    console.log(
      "---",
      s,
      c,
      t
        .slice(Math.max(0, i - 60), i + 180)
        .replace(/[\x00-\x1f]/g, "|")
    );
    i += s.length;
    c++;
  }
}
around("Get Overlapping Actors");
around("For Each Loop");
around("Last Index");
around("MemberName=\"Cube1");
around("MemberName=\"Cube2");
around("TargetArray");

const counts = [
  "Make Array",
  "Light Through Points",
  "Update Shadow",
  "Update All",
  "For Loop",
  "Loop Index",
  "CallFunc_Array_Add",
  "CallFunc_Array_Length",
  "CallFunc_Array_Clear",
  "ligth Through Point",
  "Shadow Collision Compute",
  "Set Array Elem",
];
for (const k of counts) {
  console.log("COUNT", k, (t.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length);
}

// hunt loop literal defaults in blueprint bytecode strings
const loopHints = ["Last Index", "First Index", "Loop Index", "Array_Length", "Array_Get"];
for (const k of loopHints) {
  around(k, 3);
}

// Side index pattern: only index 0 branch
around("Equal (Object)", 2);
around("Shadow Collision 1-1", 3);
around("Shadow Collision 1-2", 2);
around("Update Shadow", 3);

for (const k of needles) {
  const hits = [];
  let i = 0;
  while ((i = t.indexOf(k, i)) >= 0 && hits.length < 5) {
    hits.push(
      t
        .slice(i, i + 140)
        .replace(/[\x00-\x1f]/g, "|")
        .trim()
    );
    i += k.length;
  }
  if (hits.length) {
    console.log("\n=== " + k + " ===");
    hits.forEach((h) => console.log(h));
  }
}
