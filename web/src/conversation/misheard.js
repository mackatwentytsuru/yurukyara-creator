// 聞き取れなかったときの流れ: 1 回目は聞き返し、2 回続けたら選択式に切り替える(お客さんを何度も言い直させない)。
export const MISHEARD_LIMIT = 2;

/** 店の接客で、よく聞かれることの選択肢(押すと、その言葉がそのまま質問になる) */
export const SHOP_CHOICES = ['今日のショーは?', '今日の出演者は?', '空席はある?', '料金は?', '応援の仕方は?', 'スタッフを呼んで'];

export const RETRY_LINE = 'すみません、もう一度お願いします。';
export const CHOICES_LINE = 'うまく聞き取れませんでした。下の項目から選んでくださいね。';

export class MisheardTracker {
  constructor(limit = MISHEARD_LIMIT) {
    this.limit = limit;
    this.count = 0;
  }

  /** 声は出たのに文字にならなかった。'retry'(聞き返す)か 'choices'(選択式にする) */
  miss() {
    this.count += 1;
    return this.count >= this.limit ? 'choices' : 'retry';
  }

  /** 聞き取れた(または選んでもらえた)。数え直す */
  heard() {
    this.count = 0;
  }
}
