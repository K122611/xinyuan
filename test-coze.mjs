// 🔍 检查 Coze message/list 返回的完整消息类型
import https from 'https';
const BOT_ID='7649689722696237091', TOKEN='pat_CyuRGR2Jl8sCA5z9ExlK1leDoDsT04sDkegNp7ziiMRKEATt1uJgNCpIjFsZ8koZ', BASE='https://api.coze.cn';

function api(path,method='GET',body=null){
  return new Promise((res,rej)=>{
    const u=new URL(path,BASE),payload=body?JSON.stringify(body):null;
    const opts={hostname:u.hostname,port:443,path:u.pathname+u.search,method,headers:{'Authorization':`Bearer ${TOKEN}`},timeout:15000};
    if(payload){opts.headers['Content-Type']='application/json';opts.headers['Content-Length']=Buffer.byteLength(payload);}
    const req=https.request(opts,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))}})});
    req.on('error',e=>rej(e));req.on('timeout',()=>{req.destroy();rej(new Error('Timeout'))});
    if(payload)req.write(payload);req.end();
  });
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function t() {
  // 创建新会话，发一条消息
  const r1 = await api('/v3/chat','POST',{
    bot_id:BOT_ID,user_id:'test',stream:false,auto_save_history:true,
    additional_messages:[{role:'user',content:'你是一个情感陪伴AI叫心元。回复要简短共情。\n\n用户：我今天心情不太好',content_type:'text'}],
  });
  const convId=r1.data.conversation_id, chatId=r1.data.id;
  console.log(`convId=${convId} chatId=${chatId}`);

  await sleep(8000);

  // 获取消息列表
  const list = await api(`/v3/chat/message/list?conversation_id=${convId}&chat_id=${chatId}`);
  console.log(`code=${list.code} msgCount=${list.data?.length}`);

  // 打印每条消息的完整结构
  list.data.forEach((m,i) => {
    console.log(`\n── 消息[${i}] ──`);
    console.log(`  role: ${m.role}`);
    console.log(`  type: ${m.type}`);
    console.log(`  content_type: ${m.content_type}`);
    console.log(`  id: ${m.id}`);
    const content = typeof m.content==='string'?m.content:JSON.stringify(m.content);
    console.log(`  content(${content.length}chars): ${content.slice(0, 200)}`);
    if (content.length > 200) console.log(`  ...${content.slice(-100)}`);
  });

  // 找到 type=answer 的消息
  const answers = list.data.filter(m => m.type==='answer');
  console.log(`\n🔑 type=answer 的消息数: ${answers.length}`);
  answers.forEach((a,i) => {
    const c = typeof a.content==='string'?a.content:JSON.stringify(a.content);
    console.log(`  answer[${i}]: ${c.slice(0, 150)}`);
  });

  // 找到 role=assistant 的消息
  const assistants = list.data.filter(m => m.role==='assistant');
  console.log(`\n📌 role=assistant 的消息数: ${assistants.length}`);
  assistants.forEach((a,i) => {
    console.log(`  assistant[${i}] type=${a.type} content=${JSON.stringify(a.content).slice(0, 100)}`);
  });
}

t().catch(e=>console.error('ERROR:',e.message));
