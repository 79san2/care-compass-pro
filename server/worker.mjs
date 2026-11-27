import {consult} from "../engine/consult.mjs";
import evidence from "../knowledge/evidence.json";
import policy from "../knowledge/consultation-policy.json";
const origin="https://79san2.github.io";
export default {async fetch(req,env){
 const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin"};
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.headers.get("Origin")!==origin)return reply({error:"Forbidden"},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 if(!env.AI||!env.CONSULT_MODEL||env.ENABLE_CONSULT!=="true")return reply({error:"Consultation unavailable"},503);
 const keys=[env.CONSULT_ACCESS_KEY,...Array.from({length:5},(_,i)=>env["TEAM_ACCESS_KEY_"+(i+1)])].filter(k=>typeof k==="string"&&k.length>=24);
 if(!keys.length)return reply({error:"Access not configured"},503);
 const supplied=req.headers.get("Authorization")||"";
 const enc=new TextEncoder();
 const a=await crypto.subtle.digest("SHA-256",enc.encode(supplied));
 let authorized=false;
 for(const key of keys){
 const b=await crypto.subtle.digest("SHA-256",enc.encode("Bearer "+key));
 authorized=crypto.subtle.timingSafeEqual(a,b)||authorized;
 }
 if(!authorized)return reply({error:"Unauthorized"},401);
 try{
 const raw=await req.text();if(raw.length>24000)return reply({error:"Too large"},413);
 const body=JSON.parse(raw);if(typeof body.question!=="string"||!body.question.trim()||body.question.length>4000)return reply({error:"Invalid question"},400);
 const history=Array.isArray(body.history)?body.history.filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.content==="string").slice(-6).map(x=>({role:x.role,content:x.content.slice(0,2000)})):[];
 const result=await consult({question:body.question,history,evidence,policy,generate:async messages=>{const output=await env.AI.run(env.CONSULT_MODEL,{messages,max_tokens:env.CONSULT_MODEL.includes("gpt-oss")?6000:3000});
 if(typeof output.response==="string")return output.response;
 if(typeof output.choices?.[0]?.message?.content==="string")return output.choices[0].message.content;
 if(Array.isArray(output.output))return output.output.filter(x=>x.type==="message"&&x.role==="assistant").flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("\n");
 throw Error("Unsupported model response");}});
 return reply(result);
 }catch(e){const status=Number(e?.status??e?.statusCode);const message=String(e?.message??"");if(status===429||/quota|rate limit|neuron limit|daily limit|too many requests/i.test(message))return reply({error:"Usage limit reached"},429);return reply({error:"Consultation failed"},502);}
}};
