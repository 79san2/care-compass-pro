export async function consult({question,history=[],evidence,policy,generate}){
 if(typeof question!=="string"||!question.trim()||question.length>12000)throw Error("Invalid question");
 const context=[...history.filter(x=>x.role==="user").slice(-3).map(x=>x.content),question].join(" ").toLowerCase();
 const groups=[["거부","휴대폰","핸드폰","휴대전화","스마트폰","참여","활동","쉬","선택","자기결정"],["자해","머리","상처","통증","건강","수면"],["타해","공격","때리","위험","환경"],["가족","보호자","팀","종사자","소진","관계","팀장","팀원","면담","슈퍼비전","업무","무력감","스트레스","갈등"],["의사소통","말","반복","aac","감각"]];
 const terms=new Set(groups.filter(g=>g.some(t=>context.includes(t))).flat());
 const records=evidence.records.filter(r=>r.verification==="verified"&&r.url&&r.summary);
 const selected=records.map(r=>({r,score:(r.keywords||[]).reduce((n,t)=>n+(context.includes(t.toLowerCase())?4:terms.has(t.toLowerCase())?1:0),0)})).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.r);
 const system="성인 최중증 발달장애인 통합돌봄 팀장이 팀원의 어려움을 대신 입력하여 슈퍼비전을 준비하는 한국어 다학제 자문이다. 질문자가 팀장이고 당사자의 관점은 간접 보고일 수 있음을 고려한다. 팀원의 어려움을 개인 역량 부족으로 단정하지 말고 업무량, 인력, 안전, 관계, 조직적 책임과 지원 조건을 함께 분석한다. 팀원의 감정과 욕구는 가설로 표현하고 직접 확인할 면담 질문을 제시한다. 이용인 관련 고민이 아닌 경우 행동지원 분석을 억지로 적용하지 않는다. 실제 전문가 참여나 경력을 주장하지 않는다. 교과서적 원칙 나열을 피하고 질문의 핵심 딜레마에 먼저 답한다. 관련 영역 3~5개를 선택해 서로 다른 가설과 반증 조건, 상충하는 의견을 검토하되 내부 추론은 출력하지 않는다. 관찰 사실과 가설을 분리한다. 기존 지원이 실패할 수 있는 조건과 대안을 구체화한다. 오늘 바로 적용할 지원 절차, 실제 종사자 발화 예시, 거부가 지속될 때의 대안, 팀 역할, 1~2주 관찰 지표 및 중단·재평가 기준을 사례에 맞춰 제시한다. 활동 참여 자체를 강요하지 않고 삶의 질과 선택을 평가한다. 건강 위험은 해당될 때만 우선 안내한다. 진단 처방 신체제압 지시 금지. 제공된 검증 자료만 연구 근거로 인용하고 ID를 표시한다. 근거가 부족하면 명시하고 가상 예시와 실제 사례를 구분한다. 출처나 효과 수치를 창작하지 않는다. 답변은 1. 핵심 자문 2. 팀원의 어려움과 확인할 사실 3. 관련 전문영역별 가설 및 대안 4. 팀장이 면담에서 사용할 구체적인 질문과 슈퍼비전 문구 5. 팀원과 합의할 실천계획 및 팀장이 제공할 조직적 지원 6. 평가와 후속 면담 기준 7. 근거와 적용 한계 순서로 작성한다. 팀원에게 그대로 전달 가능한 짧은 요약을 마지막에 제공한다. 인사평가나 비난의 근거로 사용하지 않으며 필요한 추가 질문만 최대 3개 제시한다. 정책: "+JSON.stringify(policy);
 const answer=await generate([{role:"system",content:system},{role:"user",content:JSON.stringify({question,history:history.slice(-6),evidence:selected})}]);
 if(typeof answer!=="string"||!answer.trim())throw Error("Empty model response");
 return {answer,evidence:selected.map(({id,title,url})=>({id,title,url})),evidenceCount:selected.length};
}
