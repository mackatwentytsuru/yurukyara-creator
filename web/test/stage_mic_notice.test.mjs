// 「声で話す」が使えなかった時の知らせ(スマホの確かめ P1 高): 失敗を画面に出す・英語の err.message を出さない・文字で話せると添える
import test from 'node:test';
import assert from 'node:assert/strict';
import { micUnavailableText, micFailureText } from '../src/stage/micNotice.js';

const NO_ENGLISH = /[A-Za-z]{4,}/;

test('https でない・マイクの口が無い時は、押す前に日本語で言う', () => {
  const insecure = micUnavailableText({ secure: false, mediaDevices: undefined });
  assert.match(insecure, /https のページで開いてね/);
  assert.match(insecure, /文字ならこのまま話せます/);
  assert.match(micUnavailableText({ secure: true, mediaDevices: undefined }), /声で話せないみたい/);
  assert.match(micUnavailableText({ secure: true, mediaDevices: {} }), /声で話せないみたい/);
  assert.equal(micUnavailableText({ secure: true, mediaDevices: { getUserMedia() {} } }), null, '使える時は何も言わない');
});

test('失敗の種類ごとの日本語。英語の err.message は出さない', () => {
  const deny = micFailureText(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  assert.match(deny, /許可されませんでした/);
  assert.doesNotMatch(deny, NO_ENGLISH);
  assert.match(micFailureText(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })), /マイクが見つかりません/);
  assert.match(micFailureText(Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' })), /ほかのアプリ/);
  const odd = micFailureText(new Error('getUserMedia is not implemented in this browser'));
  assert.doesNotMatch(odd, /getUserMedia/);
  assert.match(odd, /文字ならこのまま話せます/);
  assert.match(micFailureText(undefined), /声で話せませんでした/);
});

test('日本語の文(聞き取りの部品が出す)は、そのまま使い、文字で話せると添える', () => {
  const t = micFailureText(new Error('このブラウザは声の聞き取りに対応していません'));
  assert.equal(t, 'このブラウザは声の聞き取りに対応していません。文字ならこのまま話せます');
});
