import c00 from "./payload-chunk-00.mjs";
import c01 from "./payload-chunk-01.mjs";
import c02 from "./payload-chunk-02.mjs";
import c03 from "./payload-chunk-03.mjs";
import c04 from "./payload-chunk-04.mjs";
import c05 from "./payload-chunk-05.mjs";
import c06 from "./payload-chunk-06.mjs";
import c07 from "./payload-chunk-07.mjs";
import c08 from "./payload-chunk-08.mjs";
import c09 from "./payload-chunk-09.mjs";
import c10 from "./payload-chunk-10.mjs";
import c11 from "./payload-chunk-11.mjs";
import c12 from "./payload-chunk-12.mjs";
import c13 from "./payload-chunk-13.mjs";
import c14 from "./payload-chunk-14.mjs";

export const encryptedMigrationPayload = Object.freeze({
  iv: "PU1twhOFG+nwSl3M",
  tag: "7llFCZujjvAzZZI1HDlCnQ==",
  aad: "agf-historical-migration-v2-min",
  chunks: [c00, c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11, c12, c13, c14],
});
