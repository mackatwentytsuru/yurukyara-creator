// 見張り役(web/scripts/yuru-run.mjs。第 12 波 b・BUX)の試験。偽のサーバー(決めた順に「閉じる番号」を返す)と偽の命令で、
// ① 決まった番号 75 で閉じたら組み立て直して起こし直す ② 起こし直した新しい版がすぐ止まったら、1 回だけ前の版に戻して起こす
// ③ ふだんの止まり方では起こし直さない ④ lock が変わっていたら、止めている間に部品を入れ直す ⑤ 組み立ての失敗でも前の版に戻す、を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESTART_CODE, lockHash, needsInstall, runWatcher } from '../scripts/yuru-run.mjs';

// 偽のサーバー: plan の頭を 1 つ取り、crash:N = 待ち受けずにすぐ番号 N で終わる / exit:N = 待ち受けて答え、少し後に N で終わる / stay = 待ち受け続ける
const FAKE_SERVER = `
import { createServer } from 'node:http';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, 'utf8'));
const step = plan.shift() ?? 'stay';
writeFileSync(process.env.FAKE_PLAN, JSON.stringify(plan));
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ step, watcher: process.env.YURU_WATCHER, fellBack: process.env.YURU_UPDATE_FELL_BACK ?? '' }) + '\\n');
const [kind, n] = step.split(':');
if (kind === 'crash') process.exit(Number(n));
const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  if (kind === 'exit') setTimeout(() => process.exit(Number(n)), 300);
});
`;

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function setup(plan) {
  const dir = mkdtempSync(join(tmpdir(), 'yuru-run-'));
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(join(dir, 'fake_server.mjs'), FAKE_SERVER);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(dir, 'log.jsonl'), '');
  const calls = { install: 0, build: 0, undo: 0 };
  const results = { build: [] };
  const commands = {
    install: async () => (calls.install += 1, 0),
    build: async () => {
      calls.build += 1;
      return results.build.length ? results.build.shift() : 0;
    },
    undo: async () => (calls.undo += 1, 0),
    server: (env) => spawn(process.execPath, [join(dir, 'fake_server.mjs')], { env: { ...env, FAKE_PLAN: join(dir, 'plan.json'), FAKE_LOG: join(dir, 'log.jsonl') }, stdio: 'ignore', windowsHide: true }),
  };
  const port = await freePort();
  const lines = [];
  const starts = () => readFileSync(join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { dir, calls, results, commands, port, lines, starts, log: (l) => lines.push(l) };
}

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('決まった番号 75 で閉じたら、組み立て直して起こし直す(サーバーには見張り役の印)', async () => {
  const t = await setup([`exit:${RESTART_CODE}`, 'stay']);
  const w = runWatcher({ port: t.port, commands: t.commands, web: t.dir, log: t.log, fastFailMs: 5000, readyMs: 8000 });
  try {
    assert.ok(await until(() => t.starts().length === 2), '2 回起こした');
    assert.equal(t.calls.build, 2, '起こし直す前に、組み立て直した');
    assert.equal(t.calls.undo, 0);
    assert.deepEqual(t.starts().map((s) => s.watcher), ['1', '1']);
  } finally {
    w.stop();
    assert.equal(await w.done, 0);
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('起こし直した新しい版がすぐ止まったら、1 回だけ前の版に戻して起こす(画面への印 YURU_UPDATE_FELL_BACK=1)', async () => {
  const t = await setup([`exit:${RESTART_CODE}`, 'crash:1', 'stay']);
  const w = runWatcher({ port: t.port, commands: t.commands, web: t.dir, log: t.log, fastFailMs: 5000, readyMs: 8000 });
  try {
    assert.ok(await until(() => t.starts().length === 3), '3 回起こした');
    assert.equal(t.calls.undo, 1);
    assert.deepEqual(t.starts().map((s) => s.fellBack), ['', '', '1']);
    assert.ok(t.lines.some((l) => l.includes('前の版に戻します')));
  } finally {
    w.stop();
    await w.done;
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('新しくした後でない、ふだんの止まり方では起こし直さず、その番号で終わる', async () => {
  const t = await setup(['exit:2']);
  const w = runWatcher({ port: t.port, commands: t.commands, web: t.dir, log: t.log });
  assert.equal(await w.done, 2);
  assert.equal(t.calls.undo, 0);
  assert.equal(t.starts().length, 1);
  rmSync(t.dir, { recursive: true, force: true });
});

test('lock が変わっていたら、サーバーを止めている間に部品を入れ直す(印が無い時は、入っている物を今の lock の物とみなす)', async () => {
  const t = await setup([`exit:${RESTART_CODE}`, 'stay']);
  assert.equal(needsInstall(t.dir), false, '印が無い: 入っている物を今の lock とみなし、印を書く');
  assert.equal(readFileSync(join(t.dir, 'node_modules', '.yuru-lock.sha256'), 'utf8'), lockHash(t.dir));
  const w = runWatcher({ port: t.port, commands: t.commands, web: t.dir, log: t.log, fastFailMs: 5000, readyMs: 8000 });
  try {
    assert.ok(await until(() => t.starts().length === 1));
    writeFileSync(join(t.dir, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}'); // 新しい版で lock が変わった
    assert.ok(await until(() => t.starts().length === 2));
    assert.equal(t.calls.install, 1, '起こし直す前に 1 回入れ直した');
    assert.equal(needsInstall(t.dir), false, '入れ直した後は印が新しい lock');
  } finally {
    w.stop();
    await w.done;
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('新しい版の組み立てに失敗したら、前の版に戻して組み立て直す', async () => {
  const t = await setup([`exit:${RESTART_CODE}`, 'stay']);
  t.results.build.push(0, 1, 0); // 最初は通る・新しい版は失敗・戻した版は通る
  const w = runWatcher({ port: t.port, commands: t.commands, web: t.dir, log: t.log, fastFailMs: 5000, readyMs: 8000 });
  try {
    assert.ok(await until(() => t.starts().length === 2));
    assert.equal(t.calls.undo, 1);
    assert.equal(t.calls.build, 3);
    assert.equal(t.starts()[1].fellBack, '1');
  } finally {
    w.stop();
    await w.done;
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('node_modules が無ければ、最初に部品を入れる', async () => {
  const t = await setup(['exit:0']);
  rmSync(join(t.dir, 'node_modules'), { recursive: true, force: true });
  t.commands.install = async () => {
    t.calls.install += 1;
    mkdirSync(join(t.dir, 'node_modules'));
    return 0;
  };
  const w = runWatcher({ port: t.port, commands: t.commands, web: t.dir, log: t.log });
  assert.equal(await w.done, 0);
  assert.equal(t.calls.install, 1);
  rmSync(t.dir, { recursive: true, force: true });
});
