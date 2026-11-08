// 画面を消さない(接客モード)。Screen Wake Lock を取り、画面が裏に回って戻った時(取り上げられている)に取り直す。
// 使えない端末(古い iPhone など)・断られた時も止まらない(画面の固定やアクセスガイドで補う。README)。DOM は引数で受ける(node の試験で読む)。

/**
 * @param {{nav?: any, doc?: any}} [o]
 */
export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let want = false;
  let sentinel = null;
  let pending = false;

  const acquire = async () => {
    if (!want || pending || sentinel || !nav?.wakeLock?.request) return false;
    if (doc?.visibilityState && doc.visibilityState !== 'visible') return false; // 裏にいる間は取れない。戻った時に取り直す
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!want) {
        s?.release?.().catch?.(() => {});
        return false;
      }
      sentinel = s;
      s?.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null;
      });
      return true;
    } catch {
      return false; // 断られた・使えない: そのまま(電池の少ない時など)
    } finally {
      pending = false;
    }
  };

  const onVisible = () => {
    if (want && doc?.visibilityState === 'visible') void acquire();
  };

  return {
    /** 取り始める(使う人の操作の中で呼ぶ)。戻った時の取り直しも始める */
    start() {
      if (want) return acquire();
      want = true;
      doc?.addEventListener?.('visibilitychange', onVisible);
      return acquire();
    },
    /** 離す(接客モードを出る時) */
    async stop() {
      want = false;
      doc?.removeEventListener?.('visibilitychange', onVisible);
      const s = sentinel;
      sentinel = null;
      try {
        await s?.release?.();
      } catch {
        // すでに離れている
      }
    },
    get held() {
      return Boolean(sentinel);
    },
    get wanted() {
      return want;
    },
  };
}
