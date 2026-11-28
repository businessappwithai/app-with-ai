// Drives the overlay's `pg` driver the way Kysely does: one Client per
// connection, BEGIN/COMMIT/ROLLBACK as plain statements. Prints one JSON line.
process.env.PGLITE_QUIET = "true";
const path = require("node:path");
const { Pool } = require(path.resolve(process.argv[2]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = new Pool({});

async function tx(work) {
  const c = await pool.connect();
  await c.query("begin");
  try {
    const out = await work(c);
    await c.query("commit");
    return out;
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
const val = async (id) => (await pool.query("select s, v from t where id = $1", [id])).rows[0];

(async () => {
  const result = {};
  await pool.query("create table t(id int primary key, s text, v int default 1)");
  await pool.query("insert into t values (1,'a'),(2,'a')");

  // A failure rolls the transaction back.
  await tx(async (c) => {
    await c.query("update t set s='moved' where id=1");
    await c.query("insert into t(nope) values (1)");
  }).catch(() => undefined);
  result.rollback = (await val(1)).s;

  // A transaction opened inside another does not end the outer one: the outer's
  // failure still undoes everything, the inner commit included.
  await tx(async (c) => {
    await c.query("update t set s='outer' where id=1");
    await tx((i) => i.query("update t set s='inner' where id=2"));
    await c.query("insert into t(nope) values (1)");
  }).catch(() => undefined);
  result.nestedOuterRollback = [(await val(1)).s, (await val(2)).s];

  // An inner failure rolls back only the inner.
  await tx(async (c) => {
    await c.query("update t set s='outer' where id=1");
    await tx(async (i) => {
      await i.query("update t set s='inner' where id=2");
      await i.query("insert into t(nope) values (1)");
    }).catch(() => undefined);
  });
  result.nestedInnerRollback = [(await val(1)).s, (await val(2)).s];

  // Two saves from the same version: exactly one wins.
  const save = (label) =>
    tx(async (c) => {
      const row = (await c.query("select v from t where id=1 for update")).rows[0];
      await sleep(30);
      if (row.v !== 1) return "409";
      await c.query("update t set v=2, s=$1 where id=1", [label]);
      return "200";
    });
  result.parallel = (await Promise.all([save("x"), save("y")])).sort();

  // A write outside any transaction, made while another request's transaction
  // is open, is not lost when that transaction rolls back.
  await pool.query("update t set v=1 where id=2");
  const long = tx(async (c) => {
    await c.query("update t set s='tmp' where id=1");
    await sleep(200);
    throw new Error("no");
  }).catch(() => undefined);
  await sleep(50);
  await pool.query("update t set v=7 where id=2");
  await long;
  result.outsideWrite = [(await val(2)).v, (await val(1)).s !== "tmp"];

  console.log(JSON.stringify(result));
  process.exit(0);
})();
