const CHUNKS = [
  ...require('../data/contracts-1.json'),
  ...require('../data/contracts-2.json'),
  ...require('../data/contracts-3.json'),
  ...require('../data/contracts-4.json'),
  ...require('../data/contracts-5.json'),
  ...require('../data/contracts-6.json')
];

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 25;
const hits = new Map();

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function clientKey(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anonymous';
  return String(raw).split(',')[0].trim();
}

function checkRateLimit(key) {
  const now = Date.now();
  const item = hits.get(key);
  if (!item || now - item.start > WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    return true;
  }
  item.count += 1;
  return item.count <= LIMIT;
}

const synonyms = {
  '수의': ['1인견적','2인이상','견적','수의계약'],
  '서류': ['구비서류','징구','계약서','확인서','서약서'],
  '공사': ['착공','준공','하자','공사계약'],
  '용역': ['착수','완료','용역계약'],
  '물품': ['구매','물품계약','규격','사양서'],
  '청렴': ['청렴서약','청렴공고','공익제보'],
  '위원회': ['선정위원회','평가위원회','통합선정위원회'],
  '가격': ['추정가격','계약금액','예정가격','금액']
};

function tokens(q) {
  const base = cleanText(q).toLowerCase().match(/[가-힣a-z0-9]+/g) || [];
  const out = new Set(base.filter(x => x.length > 1));
  for (const token of [...out]) {
    for (const [key, list] of Object.entries(synonyms)) {
      if (token.includes(key) || key.includes(token)) list.forEach(x => out.add(x.toLowerCase()));
    }
  }
  return [...out];
}

function retrieve(q, count) {
  const qs = tokens(q);
  const normalizedQ = cleanText(q).toLowerCase();
  return CHUNKS.map(c => {
    const hay = `${c.location} ${c.text}`.toLowerCase();
    let score = 0;
    for (const t of qs) {
      const occ = hay.split(t).length - 1;
      if (occ > 0) score += Math.min(occ, 4) * (t.length >= 4 ? 4 : 2);
      if (c.location.toLowerCase().includes(t)) score += 4;
    }
    if (normalizedQ.includes('얼마') && /천만원|억원|백만원|금액|가격/.test(hay)) score += 4;
    if (/서류|필요|준비/.test(normalizedQ) && /서류|징구|제출|확인서|서약서/.test(hay)) score += 3;
    return { ...c, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, count || 8);
}

function parseGeminiText(payload) {
  return payload?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

function parseJsonLoose(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Vercel 환경변수 GEMINI_API_KEY가 설정되지 않았습니다.' });
  if (!checkRateLimit(clientKey(req))) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });

  try {
    const question = cleanText(req.body?.question);
    if (!question) return res.status(400).json({ error: '질문을 입력해 주세요.' });
    if (question.length > 800) return res.status(400).json({ error: '질문은 800자 이하로 입력해 주세요.' });

    const found = retrieve(question, 8);
    if (!found.length) {
      return res.status(200).json({ answer: '첨부된 「서울특별시교육청 계약업무 처리지침」에서 이 질문과 직접 관련된 근거를 찾지 못했습니다. 계약 유형, 금액, 업무 단계 또는 서류명을 조금 더 구체적으로 입력해 주세요.', sources: [] });
    }

    const sources = found.map((x,i) => ({ id: `S${i+1}`, location: x.location, text: x.text }));
    const context = sources.map(s => `[${s.id}] ${s.location}\n${s.text}`).join('\n\n');
    const prompt = `당신은 서울특별시교육청 계약업무 처리지침 전용 업무지원 챗봇입니다.\n\n반드시 아래 제공된 근거만 사용하십시오. 일반 지식이나 최신 법령을 임의로 보충하지 마십시오. 근거에 없는 내용은 "제공된 지침 근거만으로는 확인하기 어렵습니다"라고 답하십시오.\n\n답변 규칙:\n1. 먼저 질문에 대한 핵심 답을 한국어로 명확하게 설명합니다.\n2. 금액, 횟수, 기한, 조건 등 숫자는 근거와 정확히 일치시킵니다.\n3. 답변 문장에 관련 근거 ID를 [S1], [S2]처럼 표기합니다.\n4. citations 배열에는 실제로 사용한 근거 ID만 넣습니다.\n5. 반드시 JSON만 출력합니다: {"answer":"답변","citations":["S1"]}\n\n질문:\n${question}\n\n제공 근거:\n${context}`;

    const model = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error('Gemini API error:', payload);
      const message = payload?.error?.message || 'Gemini API 호출에 실패했습니다.';
      return res.status(502).json({ error: message });
    }

    const raw = parseGeminiText(payload);
    const parsed = parseJsonLoose(raw);
    if (!parsed) return res.status(200).json({ answer: raw || '답변을 생성하지 못했습니다.', sources: sources.slice(0,3), model });

    const cited = new Set((parsed.citations || []).map(String));
    const used = sources.filter(s => cited.has(s.id));
    return res.status(200).json({ answer: cleanText(parsed.answer) || '답변을 생성하지 못했습니다.', sources: used.length ? used : sources.slice(0,3), model });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '서버에서 답변을 생성하는 중 오류가 발생했습니다.' });
  }
};
