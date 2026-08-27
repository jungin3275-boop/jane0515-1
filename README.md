# 서울특별시교육청 계약업무 처리지침 Gemini 챗봇 - Vercel 배포용

이 버전은 브라우저에 Gemini API 키를 노출하지 않습니다.

## 폴더 구조

- `index.html` : 사용자 화면
- `api/chat.js` : Vercel 서버리스 함수. Gemini API 호출 및 근거 검색 담당
- `data/contracts-1.json` ~ `data/contracts-6.json` : 계약업무 처리지침을 검색용 근거 청크로 분할한 데이터
- `vercel.json` : Vercel 설정

## Vercel 배포 방법

1. Vercel에서 `Add New > Project`를 누릅니다.
2. GitHub 저장소 `jungin3275-boop/jane0515-1`을 Import 합니다.
3. 프로젝트의 `Settings > Environment Variables`에서 다음 값을 추가합니다.
   - `GEMINI_API_KEY` = 본인의 Gemini API 키
   - `GEMINI_MODEL` = `gemini-3.7-flash` (선택 사항)
4. `Deploy` 또는 `Redeploy` 합니다.

API 키는 Vercel 서버 환경변수에서만 사용되고 `index.html`에는 들어가지 않습니다.

## 주의

- 공개 주소로 배포하면 API 키 자체는 노출되지 않지만 누구나 챗봇을 호출해 API 사용량을 발생시킬 수 있습니다.
- 현재 동일 IP 기준 10분당 25회 기본 제한을 넣었습니다. 서버리스 인스턴스 메모리 기반이므로 강력한 사용량 통제가 필요하면 Vercel KV/Upstash 기반 제한이나 로그인 기능을 추가하는 것이 좋습니다.
- 이 챗봇의 답변 근거는 2023.12.27. 개정 지침입니다. 실제 업무 적용 전 최신 법령·지침 개정 여부를 확인하세요.
