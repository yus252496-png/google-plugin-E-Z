// translate.zvo.cn 翻译 API（国内可访问，无需 API Key）
// 基于 translate.js 社区代理，后端使用硅基流动 AI 模型
const LANG_MAP = {
  'zh-CN': 'chinese_simplified',
  'en': 'english',
  'ja': 'japanese',
  'ko': 'korean',
  'es': 'spanish',
  'fr': 'french',
  'de': 'german',
  'ru': 'russian',
  'pt': 'portuguese',
  'ar': 'arabic',
  'it': 'italian',
  'th': 'thai',
  'vi': 'vietnamese',
  'hi': 'hindi',
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'translateBatch') {
    translateBatch(request.texts, request.from, request.to)
      .then((translations) => sendResponse({ translations }))
      .catch((error) => {
        console.error('Translation error:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }
});

async function translateBatch(texts, from, to) {
  const results = [];

  // 分批翻译，每批最多 20 段文本
  const BATCH_SIZE = 20;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = await translateOneBatch(batch, from, to);
    results.push(...batchResults);
    console.debug('[翻译助手] 翻译进度:', results.length, '/', texts.length);
  }

  return results;
}

async function translateOneBatch(texts, from, to) {
  const fromCode = from && from !== 'auto' ? LANG_MAP[from] : null;
  const toCode = LANG_MAP[to] || 'chinese_simplified';

  // 构建请求参数
  const params = new URLSearchParams();
  params.set('to', toCode);
  if (fromCode) {
    params.set('from', fromCode);
  }
  params.set('text', JSON.stringify(texts));

  // 带重试的 API 调用
  let lastError = null;
  for (let retry = 0; retry < 2; retry++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s 超时

      const response = await fetch('https://api.translate.zvo.cn/translate.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: params,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.result === 1 && data.text && Array.isArray(data.text)) {
        // 确保返回数组长度匹配
        while (data.text.length < texts.length) {
          data.text.push('');
        }
        return data.text.slice(0, texts.length);
      }
      throw new Error(data.info || 'API 返回异常');
    } catch (e) {
      lastError = e;
      console.warn('[翻译助手] 翻译请求失败 (重试', retry + 1, '/ 2):', e.message);
      // 重试前等待
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.error('[翻译助手] 翻译请求全部失败:', lastError.message);
  // 全部失败，返回空字符串数组
  return texts.map(() => '');
}
