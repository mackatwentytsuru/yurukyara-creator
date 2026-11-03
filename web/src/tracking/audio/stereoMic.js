// ブラウザのマイク(ステレオ)から、声の向きを出す。USB のステレオマイク・レコーダー(録音機など)・スマホの内蔵マイクのどれでもよい。
// 2 チャンネルが取れなければ「向きは出せない」と伝え、止まらない(映像だけで動く)。
// 音は、このページの中で数字にするだけ。保存も送信もしない(MediaRecorder・通信は使わない。test/privacy.test.mjs が確かめる)。
// エコー消し・雑音抑制・自動音量は切る(ステレオが 1 つにまとめられたり、左右の音量差・時間差がつぶれるため)。
import { StereoBearingTracker } from './stereoBearing.js';

export class StereoMic {
  /**
   * @param {{deviceHint?:string, micSpacingM?:number, swapLeftRight?:boolean, ildDegPerDb?:number}} options
   *   deviceHint: マイクの名前の一部(例 "DVR")。無ければ既定のマイク
   */
  constructor(options = {}) {
    this.options = options;
    this.tracker = null;
    this.status = 'idle'; // idle | starting | stereo | mono | error
    this.info = { label: '', channels: 0, sampleRate: 0 };
    this.error = '';
  }

  async start() {
    if (this.status === 'stereo' || this.status === 'starting') return this.status;
    this.status = 'starting';
    try {
      const base = { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      let stream = await navigator.mediaDevices.getUserMedia({ audio: base });
      const hint = this.options.deviceHint?.toLowerCase();
      if (hint) {
        const dev = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label.toLowerCase().includes(hint));
        if (dev && dev.deviceId !== stream.getAudioTracks()[0]?.getSettings().deviceId) {
          stream.getTracks().forEach((t) => t.stop());
          stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: dev.deviceId } } });
        }
      }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      await this.ctx.resume().catch(() => {});
      this.info = { label: track.label, channels: settings.channelCount ?? 0, sampleRate: this.ctx.sampleRate };
      await this.ctx.audioWorklet.addModule('/stereo-tap.worklet.js');
      const src = this.ctx.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(this.ctx, 'stereo-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [1] });
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      src.connect(tap);
      tap.connect(mute).connect(this.ctx.destination); // 出力につなぐのは、部品を動かし続けるため(音は出さない)
      this.tracker = new StereoBearingTracker({ fs: this.ctx.sampleRate, ...this.options });
      this.tap = tap;
      tap.port.onmessage = (e) => {
        if (e.data.mono) {
          this.status = 'mono';
          this.info.channels = 1;
          return;
        }
        if (this.status !== 'mono') this.status = 'stereo';
        this.tracker.push(e.data.l, e.data.r);
      };
      this.status = settings.channelCount === 1 ? 'mono' : 'stereo';
      return this.status;
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      this.stop();
      return this.status;
    }
  }

  stop() {
    try {
      this.tap?.disconnect();
    } catch {
      // すでに切れている
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.tap = null;
    if (this.status !== 'error') this.status = 'idle';
  }

  /** いまの声の向きの見立て。ステレオで動いていなければ null(音なしと同じ扱い) */
  estimate() {
    return this.status === 'stereo' && this.tracker ? this.tracker.estimate() : null;
  }
}
