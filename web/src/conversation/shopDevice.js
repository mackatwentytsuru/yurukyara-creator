// お店の端末(ML1): お店や町の共用の端末で、次のお客さんに、前の人の名前や話が出ないようにする。
// 「ふつう(覚える)」(既定)と「お店の端末(お客さんの名前を覚えない)」の 2 つ。端末ごとに覚える(キャラによらない)。
// お店の端末の時:
//  - 合鍵を送らない・作らない(本文 memory:'off'。サーバーも記憶の道を通らない)。切り替えた時に、その端末の合鍵を捨てる
//  - 「いま覚えていることも消す」ボタン(今の消す道。サーバーの記録も消える)
//  - 3 分だれも操作しないと、会話の履歴・字幕・「覚えていること」の窓を空にする
// DOM も通信も持たない(通信は、渡された memoryApi が行う)。保存が使えない端末でも止まらない。

export const SHOP_DEVICE_STORE = 'yc.shopDevice.v1';
/** だれも操作しないで、画面の会話を空にするまでの時間(ms) */
export const SHOP_IDLE_CLEAR_MS = 3 * 60 * 1000;

/** 画面の言葉(性格の画面の「この端末」の枠) */
export const SHOP_DEVICE_LABELS = Object.freeze({ normal: 'ふつう(覚える)', shop: 'お店の端末(お客さんの名前を覚えない)' });
export const SHOP_DEVICE_NOTE = 'お店の端末にすると、お客さんの名前も話も覚えません。しばらく触らないと、画面の会話も消えます。この枠は、押すとすぐ変わります。';
export const SHOP_FORGET_LABEL = 'いま覚えていることも消す';
export const SHOP_FORGET_DONE = '覚えていたことを、全部消しました';
export const SHOP_FORGET_NONE = 'この端末には、覚えていることは ありません';

/**
 * @param {object} o
 * @param {{getItem:(k:string)=>string|null, setItem:(k:string,v:string)=>void, removeItem:(k:string)=>void}|null} [o.storage]
 * @param {{getKey:()=>string, setKey:(k:string)=>void, clearKey:()=>void, forgetAll:()=>Promise<unknown>}} o.memoryApi 記憶の合鍵と、消す道(src/ui/memoryKey.js の同じ名前の関数)
 * @param {()=>void} [o.onChange] ふつう ⇄ お店の端末 が替わった時(画面の再描きなど)
 */
export function createShopDevice({ storage = globalThis.localStorage, memoryApi, onChange = () => {} } = {}) {
  let on = null; // 読む前は null
  let heldKey = ''; // お店の端末に替えた時に捨てた合鍵(「いま覚えていることも消す」で、その鍵のサーバーの記録を消すため。この画面の間だけ持つ。保存しない)

  const read = () => {
    try {
      return storage?.getItem(SHOP_DEVICE_STORE) === 'on';
    } catch {
      return false;
    }
  };
  const isOn = () => {
    if (on === null) on = read();
    return on;
  };

  return {
    isOn,
    /** 切り替える。お店の端末に替えた時は、この端末の合鍵を捨てる(以後、送らない・作らない) */
    set(next) {
      const want = Boolean(next);
      const was = isOn();
      on = want;
      try {
        if (want) storage?.setItem(SHOP_DEVICE_STORE, 'on');
        else storage?.removeItem(SHOP_DEVICE_STORE);
      } catch {
        // 覚えられなくても、この画面の間は使える
      }
      if (want && !was) {
        const key = memoryApi?.getKey?.() ?? '';
        if (key) heldKey = key;
        memoryApi?.clearKey?.();
      }
      if (want !== was) onChange(want);
      return on;
    },
    /** 「いま覚えていることも消す」。サーバーの記録も消す(合鍵を捨てる前の鍵があれば、それで)。消した/消す物が無かった、を返す */
    async forgetNow() {
      const key = heldKey || memoryApi?.getKey?.() || '';
      if (!key) return { ok: true, forgotten: false, message: SHOP_FORGET_NONE };
      memoryApi.setKey(key);
      try {
        await memoryApi.forgetAll();
        heldKey = ''; // 消せた時だけ手放す(消せなかった時は、もう一度押して消せるように持っておく)
      } finally {
        memoryApi.clearKey?.(); // お店の端末の間は、どちらでも、この端末に合鍵を残さない
      }
      return { ok: true, forgotten: true, message: SHOP_FORGET_DONE };
    },
  };
}

/**
 * だれも操作しないで SHOP_IDLE_CLEAR_MS たつと onClear を呼ぶ見張り。お店の端末の時だけ動く(isOn が false の間は何もしない)。
 * touch() は、操作(押す・打つ・話しかける・返事が来る)のたびに呼ぶ。
 * @param {object} o
 * @param {()=>boolean} o.isOn
 * @param {()=>void} o.onClear 会話の履歴・字幕・「覚えていること」の窓を空にする
 * @param {number} [o.ms]
 * @param {(fn:()=>void, ms:number)=>any} [o.setTimer]
 * @param {(t:any)=>void} [o.clearTimer]
 */
export function createIdleClear({ isOn, onClear, ms = SHOP_IDLE_CLEAR_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let dirty = false; // 触られてから、まだ空にしていない(空の画面で、何度も空にしない)
  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const fire = () => {
    timer = null;
    if (!isOn() || !dirty) return;
    dirty = false;
    onClear();
  };
  return {
    touch() {
      if (!isOn()) return;
      dirty = true;
      stop();
      timer = setTimer(fire, ms);
    },
    stop,
    /** 試験用: いま数えている最中か */
    get waiting() {
      return timer !== null;
    },
  };
}
