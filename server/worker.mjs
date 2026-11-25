import {consult} from "../engine/consult.mjs";
import evidence from "../knowledge/evidence.json";
import policy from "../knowledge/consultation-policy.json";
const origin="https://79san2.github.io";
export default {async fetch(req,env){
 const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin"};
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.headers.get("Origin")!==origin)return reply({error:"Forbidden"},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 if(!env.AI||!env.CONSULT_MODEL||env.ENABLE_CONSULT!=="true")return reply({error:"Consultation unavailable"},503);
 try{
 const raw=await req.text();if(raw.length>24000)return reply({error:"Too large"},413);
 const body=JSON.parse(raw);if(typeof body.question!=="string"||!body.question.trim()||body.question.length>4000)return reply({error:"Invalid question"},400);
 const history=Array.isArray(body.history)?body.history.filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.content==="string").slice(-6).map(x=>({role:x.role,content:x.content.slice(0,2000)})):[];
 const result=await consult({question:body.question,history,evidence,policy,generate:async messages=>{const output=await env.AI.run(env.CONSULT_MODEL,{messages,max_tokens:2500});return output.response;}});
 return reply(result);
 }catch{return reply({error:"Consultation failed"},502);}
}};
