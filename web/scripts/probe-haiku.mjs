// サーバーを通さずに、実際の指示文で Haiku を直接呼び、最初の文字までの時間を測る。
//   node scripts/probe-haiku.mjs [回数=10]     鍵は環境変数 ANTHROPIC_API_KEY(値は表示しない)
// サーバー経由の時間(measure-latency)と比べて、遅れが API 側か自分の側かを切り分けるのに使う。
import { buildSystemPrompt, buildUserTurn } from '../server/prompt.mjs';
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error('ANTHROPIC_API_KEY が環境変数にありません');
const system = buildSystemPrompt({ character:{name:'試しのキャラ',persona:'明るい受付'}, place:{name:'試しの場所',landmarks:[{name:'お手洗い',where:'左奥、約 3.8m'},{name:'入口',where:'手前、約 2.5m'}]}, expressions:['neutral','happy','surprised','sad','think'] });
const variants = Array.from({length: Number(process.argv[2] ?? 10)}, () => ({}));
for (const [i, extra] of variants.entries()) {
  if (i) await new Promise(r=>setTimeout(r,5500));
  const t0 = performance.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({ model:'claude-haiku-5-5', max_tokens:700, stream:true, system: [{type:'text',text:system,cache_control:{type:'ephemeral'}}], messages:[{role:'user',content:buildUserTurn({text:'お手洗いはどこですか',scene:'1 人が見えている: 正面 約 1.0m'})}], ...extra }) });
  let first=null, text='', usage=null; const dec=new TextDecoder(); let buf='';
  for await (const c of res.body) { buf+=dec.decode(c,{stream:true}); let k; while((k=buf.indexOf('\n\n'))>=0){ const b=buf.slice(0,k); buf=buf.slice(k+2); const d=b.split('\n').find(l=>l.startsWith('data:')); if(!d) continue; const ev=JSON.parse(d.slice(5)); if(ev.type==='content_block_delta'&&ev.delta.type==='text_delta'){ if(first===null) first=performance.now()-t0; text+=ev.delta.text;} if(ev.type==='message_start') usage=ev.message.usage; if(ev.type==='message_delta') usage={...usage,...ev.usage}; } }
  console.log(`#${i} ${JSON.stringify(extra)} first ${first?.toFixed(0)}ms total ${(performance.now()-t0).toFixed(0)}ms`, JSON.stringify(usage));
}
