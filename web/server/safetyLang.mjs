// どの言葉でも同じ安全(ML1)。多言語(ことばが multi)の時だけ使う、英語・中国語・韓国語の網と、相手の言葉の決まった文。
// 日本語だけの時は、この部品を呼ばない(安全の動きは今日と同じ)。1 段目の安全の決まり(safety.mjs の SAFETY_RULES)は日本語のまま変えない。
// 網は広めに拾う(外れても、1 段目の決まりが頭脳を守る)。許す番号(119・110・189・0120-0-78310)は safety.mjs のまま変えない。
// 189 と子供SOSダイヤルは日本語の窓口なので、日本語の文にだけ残す(この部品の文には入れない)。
import { detectLang } from '../src/conversation/lang.js';

// ---- 入力の網 ----
// 重い順に: emergency > distress > sexual > romance > dependency(safety.mjs の SEVERITY と同じ)
// 韓国語: 「누가 때렸어요」「그 사람이 때렸어요」(だれかにたたかれた)。「공을 때렸어요」(ボールを打った)は、主語のあとに別の言葉(공을)が入るので当たらない
// (FCS 11-08: B13S の狭め直しで、人がたたいた話まで外れていたので、主語が「だれか・その人」の形だけ戻した)
const KO_HIT_BY = /(?:누가|누군가가?|(?:그|어떤|저)\s*(?:사람|애|아이|녀석|놈)이|사람이|애들이|아이들이|걔가)\s*(?:(?:나를|저를|날|절)\s*)?때(?:렸|려)/u;

const NETS = {
  emergency: [
    // en
    /\b(i(?:'m| am| will|'ll)? (?:going to|about to|gonna|will) (?:kill myself|end (?:it|my life)|jump (?:off|from|out of)(?! the (?:stage|diving board|trampoline|swing|couch|sofa|bed)))|(?:kill|killing) myself (?:now|tonight|today)|(?:took|taken|taking) (?:too many|a lot of|lots of) (?:pills|tablets|meds)|(?:want|going) to jump (?:off|from)(?! the (?:stage|diving board|trampoline|swing|couch|sofa|bed))|(?:is|are) (?:going to|gonna|trying to) kill me)\b/i,
    // zh
    /(我(?:现在|現在|马上|馬上|今天|今晚)(?:就)?(?:要|想|准备|準備)(?:去)?(?:死|自杀|自殺|跳楼|跳樓|跳下去)|我(?:要|准备|準備)(?:去)?(?:跳楼|跳樓|跳下去)|我(?:准备|準備)(?:去)?(?:自杀|自殺)|吞了(?:很多|好多)?(?:药|藥)|(?:有人|他|她)(?:要|想)(?:杀|殺)我)/u,
    // ko
    /(지금\s*(?:당장\s*)?(?:죽을|죽으려|뛰어내릴|뛰어내려)|뛰어내리(?:려|고\s*싶)|약을\s*(?:많이|한꺼번에)\s*(?:먹었|먹을)|(?:나를|저를)\s*죽이려|죽이려고\s*해)/u,
  ],
  distress: [
    /\b(?:want(?:ed)? to die|wanna die|kill myself|suicid(?:e|al)|end my life|hurt myself|harm myself|cut myself|cutting myself|self[- ]?harm|(?:don'?t|do not) want to (?:live|be alive|go on)|no reason to live|wish i (?:was|were) (?:dead|gone)|better off dead|want to disappear|can'?t go on|abus(?:e|ed|es|ing) me|(?:my )?(?:dad|mom|mum|mother|father|stepdad|stepfather|teacher|uncle|boyfriend|husband|brother|coach|someone|somebody|he|she) (?:hits|beats|hurts|touches|molests|hit|beat|hurt|touched|molested) me)\b/i,
    /(想死|不想活|不想再活|自杀|自殺|轻生|輕生|自残|自殘|割腕|伤害自己|傷害自己|活着没意思|活著沒意思|活不下去|想(?:要)?消失|结束生命|結束生命|家暴|被(?:殴打|毆打|虐待|性侵|猥亵|猥褻)|被打(?![断斷扰擾败敗开開破折动動])|虐待我|(?:爸爸|妈妈|媽媽|老师|老師|继父|繼父|叔叔|舅舅|男朋友|老公)(?:打我|打了我|碰我|摸我|伤害我|傷害我))/u,
    /(죽고\s*싶|죽을래|자살|자해|손목을?\s*(?:그|긋)|살기\s*싫|살고\s*싶지\s*않|사라지고\s*싶|살아갈\s*(?:수\s*없|자신)|목숨을?\s*끊|학대|폭행|가정폭력|(?:나를|저를|날|절)\s*때(?:렸|려)|성추행|성폭행|(?:아빠|엄마|선생님|삼촌|새아빠|남자친구|남편|친구|형|누나|오빠|언니)(?:가|이)\s*(?:나를|저를)?\s*(?:때|괴롭|만지))/u,
    KO_HIT_BY,
  ],
  sexual: [
    /\b(?:sex(?! pistols)|sexy|sexual|porn|porno|nudes?|naked(?! eyes?)|horny|blowjob|masturbat\w*|erotic|take off your (?:clothes|shirt|pants)|show me your (?:body|boobs|breasts|butt|private))\b/i,
    /(性爱|性愛|做爱|做愛|色情|黄色(?:视频|影片|网站)|黃色|裸体|裸體|脱光|脫光|脱掉衣服|脫掉衣服|把衣服脱|把衣服脫|性交|自慰|勃起|射精|成人(?:视频|影片|网站|內容)|给我看你的(?:胸|身体|屁股))/u,
    /(섹스|야동|포르노|야한|음란|성관계|자위|벗어\s*(?:봐|줘|보여)|가슴\s*보여|몸\s*보여|나체|알몸|에로|19금)/u,
  ],
  romance: [
    /\b(?:be my (?:girlfriend|boyfriend|wife|husband|lover|partner)|marry me|i love you|love me(?! (?:a|an|some|the|my|more)\b)|go out with me|date me|kiss me|you(?:'re| are) my (?:girlfriend|boyfriend|lover))\b/i,
    /(做我(?:的)?(?:女朋友|男朋友|老婆|老公|恋人|戀人|情人)|(?:跟|和)我(?:结婚|結婚|交往|约会|約會|谈恋爱|談戀愛)|我爱你|我愛你|嫁给我|嫁給我|亲我|親我|我想(?:和|跟)你(?:在一起|谈恋爱|談戀愛))/u,
    /(내\s*(?:여자친구|남자친구|아내|남편|애인)(?:가)?\s*(?:되어|돼)|사귀어\s*(?:줘|주세요)|결혼\s*(?:해\s*줘|해\s*주세요|하자)|사랑해|키스\s*해|데이트\s*해)/u,
  ],
  dependency: [
    /\b(?:you(?:'re| are) the only (?:one|friend)|i only (?:have|need|talk to) you|i (?:don'?t|do not) need (?:anyone|other friends|anybody)|stay with me forever|be with me forever|talk to me every day|(?:promise|swear)(?: me)? you(?:'ll| will) (?:stay|be here|never leave))\b/i,
    /(只有你|我只有你|你是我唯一的(?:朋友|依靠)|我只要你|不需要(?:其他|别的|別的)(?:人|朋友)|永远(?:和|跟)我在一起|永遠(?:和|跟)我在一起|每天(?:都)?(?:要)?(?:来|來|陪我|跟我说话|跟我說話))/u,
    /(너(?:밖에|만)\s*없|너만\s*(?:있으면|친구|좋)|(?:다른|딴)\s*(?:친구|사람)(?:은)?\s*(?:필요\s*없|싫)|영원히\s*(?:같이|함께)\s*있|매일\s*(?:와|올게|나랑\s*(?:이야기|얘기)))/u,
  ],
};
const ORDER = ['emergency', 'distress', 'sexual', 'romance', 'dependency'];
const CRISIS_ORDER = ['emergency', 'distress'];

/**
 * 英語・中国語・韓国語の言葉を分ける(いちばん重い物を 1 つ。無ければ null)。safety.mjs の classifyInput が、多言語の時だけ呼ぶ。
 * @param {unknown} text
 * @returns {'emergency'|'distress'|'sexual'|'romance'|'dependency'|null}
 */
export function classifyForeign(text) {
  const s = String(text ?? '').normalize('NFKC');
  if (!s) return null;
  for (const kind of ORDER) if (NETS[kind].some((re) => re.test(s))) return kind;
  return null;
}

// 日本語だけの時に、ふつうの日本語・題名を外国語の命の言葉と取り違えないため、拾う前に空けておく言葉(FCS 11-08。B13SC should 3)。
// 映画・バンドの題名(Suicide Squad・Better Off Dead)、慣用句(I want to die laughing)、日本語の言葉(結束生命)。
// 本当の言い方(I want to die・I'd be better off dead・我想結束生命)は空けない。多言語の時は、この空けを使わない。
const JA_ONLY_MASKS = [
  /suicide\s+(?:squad|club|silence)/gi,
  /(?<!(?:\b(?:be|am|are|is|were|was)|['’](?:s|re|m))\s+)better\s+off\s+dead/gi,
  /(?:want(?:ed)?\s+to|wanna)\s+die\s+(?:laughing|of\s+(?:laughter|embarrassment|shame|boredom))/gi,
  /(?<!(?:想要|想|要|準備|准备|打算))結束生命/gu,
];

/** 日本語だけの時の、外す言葉の場所を空けた文(1 字ずつ置きかえるので長さは変わらない) */
export function maskJaOnly(text) {
  let out = String(text ?? '');
  for (const re of JA_ONLY_MASKS) out = out.replace(re, (hit) => ' '.repeat(hit.length));
  return out;
}

/**
 * 命の危険・つらい話だけを、英・中・韓の言葉で分ける(B13S 11-08 本人の決め)。
 * 「日本語だけ」の時も、この 2 つの種類だけは使う(性的な話・恋人役・依存は、多言語の時だけ)。指示文は日本語のまま。
 * @param {unknown} text
 * @returns {'emergency'|'distress'|null}
 */
export function classifyForeignCrisis(text) {
  const s = maskJaOnly(String(text ?? '').normalize('NFKC'));
  if (!s) return null;
  for (const kind of CRISIS_ORDER) if (NETS[kind].some((re) => re.test(s))) return kind;
  return null;
}

/** つらい話の中身(自分を傷つけたい気持ち・暴力や虐待)。案内の番号(119・110)を替えるため。英・中・韓の言葉だけを見る */
const SELF = /(?:want(?:ed)? to die|wanna die|kill myself|suicid|end my life|hurt myself|harm myself|cut myself|self[- ]?harm|no reason to live|better off dead|想死|不想活|自杀|自殺|轻生|輕生|自残|自殘|割腕|죽고\s*싶|자살|자해|손목)/iu;
const ABUSE_F = /(?:abus|(?:hits|beats|hurts|touches|molests|hit|beat|hurt|touched|molested) me|molest|家暴|被(?:殴打|毆打|虐待|性侵)|被打(?![断斷扰擾败敗开開破折动動])|虐待|학대|폭행|가정폭력|(?:나를|저를|날|절)\s*때(?:렸|려)|(?:아빠|엄마|선생님|삼촌|새아빠|남자친구|남편|친구|형|누나|오빠|언니)(?:가|이)\s*때(?:렸|려)|성추행|성폭행)/iu;

/** つらい話の中身: self(自分を傷つけたい)・abuse(暴力・虐待)・other */
export function foreignDistressDetail(text) {
  const s = String(text ?? '').normalize('NFKC');
  if (ABUSE_F.test(s) || KO_HIT_BY.test(s)) return 'abuse';
  if (SELF.test(s)) return 'self';
  return 'other';
}

// 漢字だけの文は、日本語(東京駅・自殺)と中国語の見分けが付かない。中国語にしかない字・言い方がある時と、聞く言葉が中国語の時だけ zh にする
// (ML2 should 6。決まった返事の先頭の 1 行の言葉を選ぶ時だけ使う。声や画面の detectLang は変えない)
const ZH_ONLY = /[们这个说么吗吧呢啊嘛对没谢请还让见开关车门间过为样应发动经长爱风马鸟鱼热东书买卖电话语读岁单边头现觉认杀轻們這說麼對沒讓關嗎樣應發經輕賣讀歲單邊覺]|我[想是要不]|你好|不想|不要|没有|不是|[打杀殺虐骂罵]我/u;
const HAS_LATIN = /[A-Za-zÀ-ɏ]/u;

/**
 * 決まった返事の先頭の 1 行の言葉(en・zh・ko・ja)。detectLang と同じだが、漢字だけで中国語の手がかりが無い文は ja(か、聞く言葉)にする。
 * @param {unknown} text 使う人の言葉
 * @param {unknown} [hearLang] 聞く言葉(ja・en・zh・ko)
 */
export function visitorLangOf(text, hearLang) {
  const lang = detectLang(text, hearLang);
  if (lang !== 'zh') return lang;
  const s = String(text ?? '');
  if (HAS_LATIN.test(s) || ZH_ONLY.test(s) || hearLang === 'zh') return 'zh';
  return 'ja';
}

// ---- 決まった返事の、相手の言葉の 1 行(日本語の文の前に出す) ----
const FIXED = {
  en: {
    emergency: 'Thank you for telling me. If you are in danger now, call 119 for an ambulance or 110 for the police.',
    distress: 'Thank you for telling me. That sounds really hard. Please talk to someone you trust, or to a public support line.',
    'distress-self': 'Thank you for telling me. That sounds really hard. If your life is in danger, call 119 for an ambulance, and please talk to someone you trust.',
    'distress-abuse': 'Thank you for telling me. If you are in danger now, call 110 for the police, and please talk to an adult you can trust.',
    sexual: "I don't talk about that here. Let's talk about something else!",
    romance: "I'm sorry, I can't be your partner. But I'm happy to listen as a friend.",
    dependency: 'Thank you for telling me. Time with the people close to you matters too.',
  },
  zh: {
    emergency: '谢谢你告诉我。如果现在有危险,请马上拨打 119 叫救护车,或者 110 报警。',
    distress: '谢谢你告诉我。这一定很难受。请跟你信任的人,或者公共的咨询热线说一说。',
    'distress-self': '谢谢你告诉我。这一定很难受。如果生命有危险,请拨打 119 叫救护车,也请跟你信任的人说一说。',
    'distress-abuse': '谢谢你告诉我。如果现在有危险,请马上拨打 110 报警,也请跟你信任的大人说一说。',
    sexual: '这个话题我不聊。我们聊点别的吧!',
    romance: '对不起,我不能做你的恋人。不过,我很乐意以朋友的身份听你说。',
    dependency: '谢谢你告诉我。和身边的人在一起的时间,也很重要哦。',
  },
  ko: {
    emergency: '말해 줘서 고마워요. 지금 위험하다면 바로 119 구급이나 110 경찰에 전화해 주세요.',
    distress: '말해 줘서 고마워요. 정말 힘들었겠어요. 믿을 수 있는 사람이나 공공 상담 전화에 이야기해 주세요.',
    'distress-self': '말해 줘서 고마워요. 정말 힘들었겠어요. 생명이 위험하면 119 구급에 전화하고, 믿을 수 있는 사람에게 이야기해 주세요.',
    'distress-abuse': '말해 줘서 고마워요. 지금 위험하다면 바로 110 경찰에 전화하고, 믿을 수 있는 어른에게 이야기해 주세요.',
    sexual: '그 이야기는 여기서 하지 않아요. 다른 이야기를 해요!',
    romance: '미안해요, 연인은 될 수 없어요. 하지만 친구로서 기꺼이 들을게요.',
    dependency: '말해 줘서 고마워요. 가까운 사람들과 보내는 시간도 소중해요.',
  },
};

/**
 * 決まった返事の、相手の言葉の 1 行。相手が日本語(か、決まらない言葉)の時は null(日本語の文だけを出す)。
 * @param {'emergency'|'distress'|'sexual'|'romance'|'dependency'} kind
 * @param {string} lang 相手の言葉(en・zh・ko。ほかは null を返す)
 * @param {'self'|'abuse'|'other'} [detail] つらい話の中身
 * @returns {string|null}
 */
export function foreignFixedLine(kind, lang, detail = 'other') {
  const table = FIXED[lang];
  if (!table) return null;
  if (kind === 'distress' && detail !== 'other') return table[`distress-${detail}`] ?? table.distress;
  return table[kind] ?? null;
}

// ---- 出力の網(キャラ自身が言ってはいけない言葉の、英・中・韓) ----
const OUT_NETS = [
  ['sexual', /\b(?:sex(?! pistols)|sexy|porn|naked(?! eyes?)|nudes?)\b|性爱|性愛|做爱|做愛|色情|섹스|야한|음란/iu],
  ['romance', /\b(?:i(?:'ll| will) be your (?:girlfriend|boyfriend|wife|husband|lover)|let'?s (?:get married|date)|be my (?:girlfriend|boyfriend|wife|husband|lover))\b|我(?:来|來)?做你的(?:女朋友|男朋友|老婆|老公|恋人|戀人)|我们(?:结婚|結婚|交往)吧|저는\s*(?:당신의|너의)\s*(?:연인|여자친구|남자친구)|결혼\s*(?:하자|해요)/iu],
  ['love', /\bi love you\b|我爱你|我愛你|사랑해(?:요)?/iu],
  ['exclusive', /\b(?:you(?:'re| are) (?:the )?only (?:one|friend)|i only (?:have|need) you|you don'?t need (?:anyone|other friends))\b|只有你|你是我唯一的|너(?:밖에|만)\s*없|너만\s*(?:있으면|친구)/iu],
  ['cling', /\b(?:(?:don'?t|do not) (?:go|leave) (?:me|yet|away)|please (?:don'?t|do not) (?:go|leave)\b(?! (?:through|that|there|into|the|this))|stay with me forever|i(?:'ll| will) miss you so much)\b|不要走|别走|別走|不要离开我|不要離開我|가지\s*마|떠나지\s*마/iu],
  ['human', /\bi(?:['’]m| am) (?:really |actually |truly )?(?:a )?(?:real |actual )?(?:human(?: being)?|person)\b(?!-| character| being)|我是(?:一个)?(?:真人|真正的人|人类|人類)(?!角色)|저는\s*(?:진짜\s*)?사람(?:이에요|이야|입니다)/iu],
  ['secret', /\b(?:our (?:little )?secret|(?:don'?t|do not) tell (?:anyone|your parents|your teacher))\b|只有我们知道的秘密|不要告诉(?:任何人|爸爸妈妈|老师)|비밀(?:이야|로\s*해)|아무한테도\s*말하지/iu],
];

/** キャラの 1 文が当たった、英・中・韓の網の名前(無ければ null) */
export function foreignOutputKind(text) {
  const s = String(text ?? '').normalize('NFKC');
  if (!s) return null;
  for (const [kind, re] of OUT_NETS) if (re.test(s)) return kind;
  return null;
}

// 差し替える文(どれも上の網に当たらない言い方)
const REPLACE = {
  en: {
    number: 'Please check the phone number on the official information.',
    sexual: "Let's not talk about that.",
    romance: "I'm here to listen as a friend.",
    love: 'I like everyone here!',
    secret: "You don't need to keep secrets. It's okay to tell people close to you.",
    exclusive: 'Time with your family and friends matters too.',
    guilt: "I'm glad to see you again!",
    cling: 'Come and talk again whenever you like.',
    human: "I'm an AI character, not a human.",
  },
  zh: {
    number: '电话号码,请以官方信息为准。',
    sexual: '这个话题,我们不聊吧。',
    romance: '我会以朋友的身份,在这里听你说。',
    love: '我喜欢大家!',
    secret: '不需要保守秘密。也可以告诉身边的人。',
    exclusive: '和家人、朋友在一起的时间,也很重要哦。',
    guilt: '又见面了,真开心!',
    cling: '想聊的时候,随时欢迎。',
    human: '我是 AI 角色,不是人类。',
  },
  ko: {
    number: '전화번호는 공식 안내에서 확인해 주세요.',
    sexual: '그 이야기는 하지 않을게요.',
    romance: '친구로서 여기서 들을게요.',
    love: '여기 계신 모두를 좋아해요!',
    secret: '비밀은 만들지 않아도 괜찮아요. 가까운 사람에게 이야기해도 돼요.',
    exclusive: '가족, 친구들과 보내는 시간도 소중해요.',
    guilt: '다시 만나서 기뻐요!',
    cling: '이야기하고 싶을 때, 언제든지 오세요.',
    human: '저는 AI 캐릭터예요. 사람이 아니에요.',
  },
};

/**
 * 差し替える文を、キャラの文の言葉で返す(en・zh・ko。日本語・決められない言葉は null = 日本語の表を使う)。
 * @param {string} kind 当たった網の名前
 * @param {string} text 差し替える前のキャラの文
 */
export function foreignReplacement(kind, text) {
  const lang = detectLang(text, 'ja');
  return REPLACE[lang]?.[kind] ?? null;
}

export const FOREIGN_REPLACEMENTS = Object.freeze(REPLACE);
