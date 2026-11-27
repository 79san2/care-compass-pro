# 전문자료 등록 절차

수집 자동화 결과는 incoming.json에 후보로 등록한다. 필수 필드: id, title, url, summary, keywords, design, limitations, verification. 후보의 verification은 unverified로 유지한다. 원문 접근, 서지정보, 대상 및 연구설계, 결과와 한계, 국내 적용 조건을 확인한 후 검토자가 evidence.json으로 이동한다. DOI 또는 정규화 URL 및 제목으로 중복을 확인한다. 개인정보 및 비공개 사례는 등록하지 않는다. 법령과 효과 연구를 구분한다. 자동 수집만으로 verified 상태를 부여하지 않는다. 기존 consult 엔진은 evidence.json의 verified 자료만 활용한다. 자동화 결과의 저장소 전송은 별도 연결 및 실행 검증이 필요하다.
